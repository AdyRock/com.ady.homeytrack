'use strict';

const mqtt = require('mqtt');
const BaseConnector = require('./BaseConnector');
const { parseLocationPayload, parseWaypointReport } = require('./parseLocation');

const TOPIC_FILTER = 'owntracks/#';

/**
 * Connects to an MQTT broker and listens for OwnTracks location reports.
 */
class MqttConnector extends BaseConnector
{

	constructor(homey, { brokerUrl, port, username, password, useTls })
	{
		super(homey);
		this.brokerUrl = brokerUrl;
		this.port = port;
		this.username = username;
		this.password = password;
		this.useTls = useTls;
		this.client = null;
	}

	/**
	 * Builds the final connection URL, forcing the mqtt:// or mqtts:// scheme to match the
	 * "Use TLS" setting regardless of what scheme (if any) the user typed in the broker URL.
	 * @returns {string}
	 */
	_buildConnectionUrl()
	{
		const host = this.brokerUrl.replace(/^mqtts?:\/\//i, '');
		return `${this.useTls ? 'mqtts' : 'mqtt'}://${host}`;
	}

	/**
	 * Validates the configured port, falling back to the TLS-appropriate default when unset.
	 * An invalid port (e.g. out of range) would otherwise throw synchronously deep inside
	 * Node's networking layer, outside of a catchable async context, crashing the app.
	 * @returns {number}
	 */
	_resolvePort()
	{
		if (this.port === undefined || this.port === null || this.port === '')
		{
			return this.useTls ? 8883 : 1883;
		}

		const port = Number(this.port);
		if (!Number.isInteger(port) || port < 1 || port > 65535)
		{
			throw new Error(`Invalid MQTT port "${this.port}" - it must be a number between 1 and 65535`);
		}

		return port;
	}

	async connect()
	{
		if (!this.brokerUrl)
		{
			throw new Error('Missing MQTT broker URL');
		}

		const port = this._resolvePort();

		return new Promise((resolve, reject) =>
		{
			let settled = false;
			// Tracks whether we've ever actually reached a connected state, so a 'close' event
			// following an initial *connection failure* isn't mistaken for a real disconnect.
			let hasConnectedOnce = false;

			this.client = mqtt.connect(this._buildConnectionUrl(), {
				port,
				username: this.username || undefined,
				password: this.password || undefined,
				reconnectPeriod: 5000,
			});

			this.client.on('connect', () =>
			{
				this.client.subscribe(TOPIC_FILTER, (err) =>
				{
					if (err)
					{
						if (!settled)
						{
							settled = true;
							reject(err);
						} else
						{
							this.emit('error', err);
						}
						return;
					}

					hasConnectedOnce = true;

					if (!settled)
					{
						settled = true;
						resolve();
					} else
					{
						// A reconnect after a dropped connection succeeded again.
						this.emit('reconnected');
					}
				});
			});

			this.client.on('error', (err) =>
			{
				if (!settled)
				{
					settled = true;
					reject(err);
					return;
				}
				this.emit('error', err);
			});

			this.client.on('close', () =>
			{
				if (hasConnectedOnce)
				{
					hasConnectedOnce = false;
					this.emit('disconnected');
				}
			});

			this.client.on('message', (topic, payload) =>
			{
				this._onMessage(topic, payload);
			});
		});
	}

	async disconnect()
	{
		if (this.client)
		{
			await new Promise((resolve) => this.client.end(false, {}, resolve));
			this.client = null;
		}
	}

	/**
	 * Publishes a retained JSON message (e.g. an OwnTracks "card") to the given topic, so other
	 * OwnTracks apps subscribed to it (typically the same topic a user's own locations arrive
	 * on) pick it up directly from the broker.
	 * @param {string} topic
	 * @param {object} payload
	 */
	publish(topic, payload)
	{
		if (!this.client)
		{
			return;
		}

		this.client.publish(topic, JSON.stringify(payload), { retain: true, qos: 0 });
	}

	/**
	 * Requests an immediate location report from an OwnTracks device. Remote Commands must be
	 * enabled in OwnTracks. QoS 1 follows OwnTracks' recommendation for devices that may sleep.
	 * @param {string} locationTopic The device's base topic (owntracks/user/device).
	 * @returns {boolean} Whether the command was published.
	 */
	requestLocation(locationTopic)
	{
		if (!this.client || !locationTopic)
		{
			return false;
		}

		this.client.publish(
			`${locationTopic.replace(/\/$/, '')}/cmd`,
			JSON.stringify({ _type: 'cmd', action: 'reportLocation' }),
			{ retain: false, qos: 1 },
		);
		return true;
	}

	/**
	 * Replaces all waypoints on an OwnTracks device with Homey's shared waypoint list.
	 * @param {string} locationTopic The device's base topic (owntracks/user/device).
	 * @param {object[]} waypoints
	 * @returns {boolean} Whether the commands were published.
	 */
	syncWaypoints(locationTopic, waypoints)
	{
		if (!this.client || !locationTopic)
		{
			return false;
		}

		const commandTopic = `${locationTopic.replace(/\/$/, '')}/cmd`;
		const options = { retain: false, qos: 1 };
		this.client.publish(commandTopic, JSON.stringify({ _type: 'cmd', action: 'clearWaypoints' }), options);

		if (waypoints.length)
		{
			this.client.publish(commandTopic, JSON.stringify({
				_type: 'cmd',
				action: 'setWaypoints',
				waypoints: {
					_type: 'waypoints',
					waypoints: waypoints.map((waypoint) => ({ _type: 'waypoint', ...waypoint })),
				},
			}), options);
		}

		return true;
	}

	_onMessage(topic, payload)
	{
		let raw;
		try
		{
			raw = JSON.parse(payload.toString());
		} catch (err)
		{
			this.emit('error', new Error(`Invalid OwnTracks payload on topic ${topic}`));
			return;
		}

		raw.topic = topic;
		const location = parseLocationPayload(raw);
		if (location)
		{
			this.emit('location', location);
		}

		const waypointReport = parseWaypointReport(raw);
		if (waypointReport && waypointReport.complete)
		{
			this.emit('waypoints', waypointReport);
		} else if (waypointReport)
		{
			this.emit('waypoint', { ...waypointReport.waypoints[0], ...waypointReport });
		}
	}

}

module.exports = MqttConnector;
