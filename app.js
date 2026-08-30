'use strict';

if (process.env.DEBUG === '1')
{
	// eslint-disable-next-line node/no-unsupported-features/node-builtins, global-require
	require('inspector').open(9229, '0.0.0.0', true);
}

const Homey = require('homey');
const nodemailer = require('nodemailer');
const { createConnector, CONNECTION_METHOD_HTTP } = require('./lib/connectors');

const SETTINGS_KEYS = [
	'connectionMethod',
	'mqttBrokerUrl',
	'mqttUseTls',
	'mqttPort',
	'mqttUsername',
	'mqttPassword',
];

const MAX_LOG_BUFFER_BYTES = 20 * 1024;

module.exports = class MyApp extends Homey.App
{

	/**
	 * onInit is called when the app is initialized.
	 */
	async onInit()
	{
		this.connector = null;
		this.personEnteredZoneCard = this.homey.flow.getTriggerCard('person_entered_zone');
		this.personLeftZoneCard = this.homey.flow.getTriggerCard('person_left_zone');
		this.lastLocations = new Map();
		this.connectionStatus = { connected: false, connecting: true, method: null, error: null };
		this.logBuffer = [];

		// Default "logsEnabled" to false on first run, so its state is explicit and predictable
		// rather than relying on an unset setting happening to be falsy.
		if (this.homey.settings.get('logsEnabled') === null)
		{
			this.homey.settings.set('logsEnabled', false);
		}

		// Safety net: a bad connector config (e.g. an invalid MQTT port) must never be able to
		// crash the whole app process via an uncaught exception or unhandled rejection.
		process.on('unhandledRejection', (err) => this._logError('Unhandled rejection', err));
		process.on('uncaughtException', (err) => this._logError('Uncaught exception', err));

		await this._reconnect();

		this.homey.settings.on('set', (key) =>
		{
			if (SETTINGS_KEYS.includes(key))
			{
				this._reconnect().catch((err) => this._logError('Failed to reconnect OwnTracks connector', err));
			}
		});

		this._log(`MyApp has been initialized (log messages ${this.homey.settings.get('logsEnabled') ? 'enabled' : 'disabled'})`);
	}

	/**
	 * Logs normally (this.log) and also captures the message into an in-memory ring buffer
	 * (capped at ~20KB), viewable from the settings page's Logs tab, but only when the
	 * "logsEnabled" setting is on. this.log/this.error themselves are read-only on Homey.App
	 * and can't be reassigned, hence separate wrappers.
	 */
	_log(...args)
	{
		if (this.homey.settings.get('logsEnabled'))
		{
			this._appendLogEntry('log', args);
		}
		this.log(...args);
	}

	/**
	 * Errors are always captured into the buffer, regardless of the "logsEnabled" setting.
	 */
	_logError(...args)
	{
		this._appendLogEntry('error', args);
		this.error(...args);
	}

	_appendLogEntry(level, args)
	{
		const message = args.map((arg) =>
		{
			if (arg instanceof Error) return arg.stack || arg.message;
			return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
		}).join(' ');

		this.logBuffer.push(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`);

		while (this.logBuffer.length > 1 && Buffer.byteLength(this.logBuffer.join('\n'), 'utf8') > MAX_LOG_BUFFER_BYTES)
		{
			this.logBuffer.shift();
		}

		this.homey.api.realtime('log_updated', this.getLogsText());
	}

	/**
	 * @returns {string} The last ~20KB of logged messages, newest last.
	 */
	getLogsText()
	{
		return (this.logBuffer || []).join('\n');
	}

	/**
	 * Empties the in-memory log buffer.
	 */
	clearLogs()
	{
		this.logBuffer = [];
		this.homey.api.realtime('log_updated', this.getLogsText());
	}

	/**
	 * Emails the current log buffer using the SMTP details from env.json.
	 */
	async emailLogs()
	{
		const transporter = nodemailer.createTransport({
			host: Homey.env.MAIL_HOST,
			port: 465,
			secure: true,
			auth: {
				user: Homey.env.MAIL_USER,
				pass: Homey.env.MAIL_SECRET,
			},
		});

		await transporter.sendMail({
			from: Homey.env.MAIL_USER,
			to: Homey.env.MAIL_RECIPIENT,
			subject: 'Homey Tracks - App Logs',
			text: this.getLogsText() || '(no log messages)',
		});
	}

	/**
	 * @returns {{ connected: boolean, method: string|null, error: string|null }}
	 */
	getConnectionStatus()
	{
		return this.connectionStatus;
	}

	/**
	 * Forwards an OwnTracks HTTP mode payload to the active connector.
	 * Called by api.js when a request hits the app's events endpoint.
	 * @param {object} body The parsed JSON body posted by OwnTracks.
	 * @param {{ user?: string, device?: string }} [context] Optional user/device hints (e.g. the userId path parameter).
	 */
	handleOwnTracksHttp(body, context)
	{
		if (!this.connector || this.connector.constructor.name !== 'HttpConnector')
		{
			throw new Error('The app is not configured for HTTP connections');
		}
		this.connector.ingest(body, context);
	}

	/**
	 * @param {string} user
	 * @param {string} device
	 * @returns {object|undefined} The last known location for the given user/device.
	 */
	getLastLocation(user, device)
	{
		return this.lastLocations.get(`${user}/${device}`);
	}

	/**
	 * Builds "card" (name/avatar), "location" and "waypoints" (shared zones) entries for every
	 * paired User device, so an OwnTracks HTTP response can show all family members (with
	 * avatars) on the same map, and keep everyone's zones in sync.
	 * @returns {Promise<object[]>}
	 */
	async buildFriendsResponse()
	{
		const devices = this.homey.drivers.getDriver('user').getDevices();
		const entries = [];

		for (const device of devices)
		{
			entries.push(...await device.getFriendPayload().catch(() => []));
		}

		const waypoints = this.listWaypoints();
		if (waypoints.length)
		{
			entries.push({
				_type: 'waypoints',
				waypoints: waypoints.map((wp) => ({ _type: 'waypoint', ...wp })),
			});
		}

		return entries;
	}

	/**
	 * @returns {{ id: string, name: string, hasAvatar: boolean, avatarBase64: string|null }[]} The
	 * paired User devices, for the settings page's avatar upload UI.
	 */
	listUsers()
	{
		return this.homey.drivers.getDriver('user').getDevices().map((device) => ({
			id: device.getData().id,
			name: device.getName(),
			hasAvatar: Boolean(device.getStoreValue('avatarBase64')),
			avatarBase64: device.getStoreValue('avatarBase64') || null,
		}));
	}

	/**
	 * @returns {{ id: string, name: string, avatarBase64: string|null, lastLocation: object|null, track: object[] }[]}
	 * Each paired User device's last known location and recorded track history, for the
	 * settings page's Map tab.
	 */
	listTracks()
	{
		return this.homey.drivers.getDriver('user').getDevices().map((device) => ({
			id: device.getData().id,
			name: device.getName(),
			avatarBase64: device.getStoreValue('avatarBase64') || null,
			lastLocation: device.getStoreValue('lastLocation') || null,
			track: device.getStoreValue('track') || [],
		}));
	}

	/**
	 * Stores an uploaded avatar image (base64, no data-URI prefix) for the given paired user.
	 * @param {string} userId
	 * @param {string} base64
	 */
	async setUserAvatar(userId, base64)
	{
		const device = this.homey.drivers.getDriver('user').getDevices()
			.find((candidate) => candidate.getData().id === userId);

		if (!device)
		{
			throw new Error(`No paired user found with id "${userId}"`);
		}

		await device.setUploadedAvatar(base64);
		await this._publishMqttCard(device);
	}

	/**
	 * For MQTT mode, publishes this user's avatar as a retained OwnTracks "card" message to the
	 * exact topic their own locations arrive on, so other users' apps (subscribed to that same
	 * topic) pick it up directly from the broker. HTTP mode already handles this via
	 * buildFriendsResponse(), so this is a no-op there.
	 * @param {import('./drivers/user/device')} device
	 */
	async _publishMqttCard(device)
	{
		if (!this.connector || typeof this.connector.publish !== 'function')
		{
			return;
		}

		const topic = device.getStoreValue('lastTopic');
		const face = await device.getAvatarBase64();
		if (!topic || !face)
		{
			return;
		}

		const cardTopic = topic.endsWith('/info') ? topic : `${topic}/info`;
		const topicDevice = topic.split('/').filter(Boolean).pop();
		const tid = device.getStoreValue('lastTrackerId') || (topicDevice && topicDevice.slice(-2).toUpperCase()) || device.getUserId().slice(-2).toUpperCase();
		const card = { _type: 'card', tid, name: device.getName(), face };
		this.connector.publish(cardTopic, card);
		this._log(`Published MQTT card: ${JSON.stringify({ topic: cardTopic, _type: card._type, tid: card.tid, name: card.name, faceBytes: Buffer.byteLength(face, 'base64') })}`);
	}

	async _reconnect()
	{
		if (this.connector)
		{
			this.connector.removeAllListeners();
			await this.connector.disconnect();
			this.connector = null;
		}

		const method = this.homey.settings.get('connectionMethod') || CONNECTION_METHOD_HTTP;
		this._setConnectionStatus({ connected: false, connecting: true, method, error: null });

		this.connector = createConnector(this.homey);
		this.connector.on('location', (location) => this._onLocation(location));
		this.connector.on('waypoint', (waypoint) => this._onWaypoint(waypoint));
		this.connector.on('error', (err) =>
		{
			this._logError('OwnTracks connector error', err);
			this._setConnectionStatus({ connected: false, connecting: false, method, error: this._describeError(err) });
		});
		this.connector.on('reconnected', () => this._setConnectionStatus({ connected: true, connecting: false, method, error: null }));
		this.connector.on('disconnected', () => this._setConnectionStatus({ connected: false, connecting: false, method, error: 'Disconnected from broker' }));

		try
		{
			await this.connector.connect();
			this._log(`OwnTracks connector connected (${method})`);
			this._setConnectionStatus({ connected: true, connecting: false, method, error: null });
		} catch (err)
		{
			this._logError('Failed to connect OwnTracks connector', err);
			this._setConnectionStatus({ connected: false, connecting: false, method, error: this._describeError(err) });
		}
	}

	/**
	 * Translates common low-level connection errors into a user-friendly explanation, while
	 * keeping the original message for reference.
	 * @param {Error} err
	 * @returns {string}
	 */
	_describeError(err)
	{
		const message = (err && err.message) || String(err);
		const code = err && err.code;

		if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
		{
			return `Could not find the broker address - check the Broker URL is correct. (${message})`;
		}
		if (code === 'ECONNREFUSED')
		{
			return `Connection refused - check the broker address, port, and that it's running. (${message})`;
		}
		if (code === 'ETIMEDOUT' || message.includes('connack timeout'))
		{
			return `Connection timed out - check the port and whether "Use TLS" matches what the broker expects. (${message})`;
		}
		if (/not authorized|bad user name or password/i.test(message))
		{
			return `Authentication failed - check the username and password. (${message})`;
		}
		if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT')
		{
			return `TLS certificate problem - check "Use TLS" is set correctly for this broker. (${message})`;
		}

		return message;
	}

	/**
	 * Updates and pushes the connector's connection status to the settings page in realtime.
	 * @param {{ connected: boolean, connecting: boolean, method: string, error: string|null }} status
	 */
	_setConnectionStatus(status)
	{
		this.connectionStatus = status;
		this.homey.api.realtime('connection_status_changed', status);
	}

	_onLocation(location)
	{
		this.lastLocations.set(`${location.user}/${location.device}`, location);
		this._log(`Location update from ${location.user}/${location.device}: ${location.lat}, ${location.lon} at ${new Date(location.timestamp || Date.now()).toISOString()} (tid=${location.trackerId || 'none'}, topic=${location.topic || 'none'})`);
		this._updateUserDevice(location).catch((err) => this._logError('Failed to update user device', err));
	}

	async triggerPersonZoneEvent(type, deviceName, zone)
	{
		const card = type === 'entered' ? this.personEnteredZoneCard : this.personLeftZoneCard;
		await card.trigger({ user: deviceName, zone }, {});
	}

	/**
	 * Merges a waypoint (region/geofence) reported by an OwnTracks app into the shared list,
	 * so it can be re-synced to every other paired user's app.
	 * @param {{ desc: string, lat: number, lon: number, rad: number, tst: number }} waypoint
	 */
	_onWaypoint(waypoint)
	{
		const waypoints = this.listWaypoints();
		const existingIndex = waypoints.findIndex((wp) => wp.desc.toLowerCase() === waypoint.desc.toLowerCase());

		if (existingIndex >= 0)
		{
			waypoints[existingIndex] = waypoint;
		} else
		{
			waypoints.push(waypoint);
		}

		this.homey.settings.set('ownTracksWaypoints', waypoints);
		this._log(`Zone "${waypoint.desc}" synced from OwnTracks`);
		this._notifyWaypointsChanged();
	}

	/**
	 * Pushes the current zone list to the settings page in realtime, so it can refresh without
	 * needing to be reopened.
	 */
	_notifyWaypointsChanged()
	{
		this.homey.api.realtime('waypoints_updated', this.listWaypoints());
	}

	/**
	 * @returns {{ desc: string, lat: number, lon: number, rad: number, tst: number }[]}
	 */
	listWaypoints()
	{
		return this.homey.settings.get('ownTracksWaypoints') || [];
	}

	/**
	 * Adds or updates a zone (matched by name, case-insensitive) and persists it.
	 * @param {{ desc: string, lat: number, lon: number, rad: number }} waypoint
	 */
	addWaypoint(waypoint)
	{
		if (!waypoint || !waypoint.desc || typeof waypoint.lat !== 'number' || typeof waypoint.lon !== 'number')
		{
			throw new Error('A zone needs a name, latitude and longitude');
		}

		this._onWaypoint({
			desc: waypoint.desc,
			lat: waypoint.lat,
			lon: waypoint.lon,
			rad: typeof waypoint.rad === 'number' ? waypoint.rad : 100,
			tst: Math.round(Date.now() / 1000),
		});
	}

	/**
	 * Updates an existing zone by its original name, allowing its name and location to change.
	 * @param {string} originalDesc
	 * @param {{ desc: string, lat: number, lon: number, rad: number }} waypoint
	 */
	updateWaypoint(originalDesc, waypoint)
	{
		if (!originalDesc || !waypoint || !waypoint.desc || typeof waypoint.lat !== 'number' || typeof waypoint.lon !== 'number')
		{
			throw new Error('A zone needs a name, latitude and longitude');
		}

		const waypoints = this.listWaypoints();
		const existingIndex = waypoints.findIndex((wp) => wp.desc.toLowerCase() === originalDesc.toLowerCase());
		if (existingIndex < 0) throw new Error('Zone not found');

		const duplicateIndex = waypoints.findIndex((wp, index) => index !== existingIndex && wp.desc.toLowerCase() === waypoint.desc.toLowerCase());
		if (duplicateIndex >= 0) throw new Error('A zone with this name already exists');

		waypoints[existingIndex] = {
			desc: waypoint.desc,
			lat: waypoint.lat,
			lon: waypoint.lon,
			rad: typeof waypoint.rad === 'number' ? waypoint.rad : 100,
			tst: Math.round(Date.now() / 1000),
		};
		this.homey.settings.set('ownTracksWaypoints', waypoints);
		this._notifyWaypointsChanged();
	}

	/**
	 * Removes a zone by name (case-insensitive).
	 * @param {string} desc
	 */
	removeWaypoint(desc)
	{
		const waypoints = this.listWaypoints().filter((wp) => wp.desc.toLowerCase() !== (desc || '').toLowerCase());
		this.homey.settings.set('ownTracksWaypoints', waypoints);
		this._notifyWaypointsChanged();
	}

	/**
	 * Finds the "User" device matching the location's userId (the editable "userId" setting,
	 * not the immutable device id) and applies the update to it. Matches against either the
	 * topic's username or its device segment, since some setups share one broker login across
	 * all family members and only differentiate them via OwnTracks' "Device ID" instead.
	 * @param {{ user: string, device: string }} location
	 */
	async _updateUserDevice(location)
	{
		// Retained MQTT messages can arrive the instant we subscribe, before the "user" driver
		// has finished initializing - retry briefly instead of losing that first location.
		let driver;
		for (let attempt = 0; attempt < 5; attempt++)
		{
			try
			{
				driver = this.homey.drivers.getDriver('user');
				break;
			} catch (err)
			{
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		if (!driver)
		{
			return;
		}

		const device = driver.getDevices().find((candidate) =>
		{
			const userId = candidate.getUserId();
			return userId === location.user || userId === location.device;
		});
		if (device)
		{
			await device.updateFromLocation(location);
			await this._publishMqttCard(device).catch((err) => this._logError('Failed to publish MQTT card', err));
		}
	}

};
