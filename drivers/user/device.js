'use strict';

const Homey = require('homey');
const { distanceMeters } = require('../../lib/geo');

const TRACK_MIN_DISTANCE_METERS = 50;
const TRACK_MAX_POINTS = 500;

module.exports = class UserDevice extends Homey.Device
{

	async onInit()
	{
		this.log(`User device initialized: ${this.getName()} (${this.getData().id})`);

		if (!this.getSetting('userId'))
		{
			// First run after pairing: seed the editable userId from the immutable device id.
			await this.setSettings({ userId: this.getData().id }).catch(this.error);
		}

		await this._refreshHttpEndpoint().catch(this.error);
	}

	/**
	 * The OwnTracks-facing identifier used for matching location reports and building the HTTP
	 * endpoint URL. Editable via the "userId" setting, independent of the immutable device id.
	 * @returns {string}
	 */
	getUserId()
	{
		return this.getSetting('userId') || this.getData().id;
	}

	async _getLocalTimestamp()
	{
		try
		{
			const timezone = this.homey.clock && typeof this.homey.clock.getTimezone === 'function'
				? await this.homey.clock.getTimezone()
				: undefined;
			return new Intl.DateTimeFormat('en-GB', {
				dateStyle: 'short',
				timeStyle: 'medium',
				timeZone: timezone || undefined,
			}).format(new Date());
		} catch (err)
		{
			return new Date().toLocaleString();
		}
	}

	/**
	 * Recomputes the read-only "HTTP endpoint URL" field from the current userId setting.
	 */
	async _refreshHttpEndpoint()
	{
		const homeyId = await this.homey.cloud.getHomeyId();

		await this.setSettings({
			httpEndpoint: `https://homey-${homeyId}.connect.athom.com/api/app/com.ady.homeytrack/events/${this.getUserId()}`,
		});
	}

	/**
	 * Validates a changed "userId" setting (must be non-empty and unique) and schedules the
	 * derived "HTTP endpoint URL" field to be refreshed afterwards. Homey doesn't allow calling
	 * setSettings() again while this save is still pending, so _refreshHttpEndpoint() is
	 * deferred until just after this handler returns.
	 * @param {{ oldSettings: object, newSettings: object, changedKeys: string[] }} event
	 */
	async onSettings({ newSettings, changedKeys })
	{
		if (!changedKeys.includes('userId'))
		{
			return;
		}

		const newUserId = (newSettings.userId || '').trim();
		if (!newUserId)
		{
			throw new Error('User ID cannot be empty');
		}

		const conflict = this.homey.drivers.getDriver('user').getDevices()
			.some((candidate) => candidate.getData().id !== this.getData().id && candidate.getUserId() === newUserId);
		if (conflict)
		{
			throw new Error(`User ID "${newUserId}" is already in use by another user`);
		}

		setImmediate(() => this._refreshHttpEndpoint().catch(this.error));
	}

	/**
	 * Applies an incoming OwnTracks location report to this device's capabilities.
	 * A region matching the "Presence zones" setting (default "Home", case-insensitive) is
	 * treated as the user being present.
	 * @param {{ regions?: string[], battery?: number, lat?: number, lon?: number, accuracy?: number, timestamp?: number }} location
	 */
	async updateFromLocation(location)
	{
		const regions = Array.isArray(location.regions) ? location.regions : [];
		const zone = regions.length ? regions.join(', ') : 'Unknown';
		const isHome = regions.some((region) => this._getPresenceZones().includes(region.toLowerCase()));
		const previousZones = String(this.getCapabilityValue('zone') || '')
			.split(',')
			.map((previous) => previous.trim())
			.filter((previous) => previous && previous !== 'Unknown');

		await this.setCapabilityValue('zone', zone).catch(this.error);
		await this.setCapabilityValue('alarm_presence', isHome).catch(this.error);
		await this.setCapabilityValue('last_seen', await this._getLocalTimestamp()).catch(this.error);
		if (typeof location.lat === 'number' && typeof location.lon === 'number')
		{
			await this.setCapabilityValue('last_coordinates', `${location.lat}, ${location.lon}`).catch(this.error);
		}

		const currentZones = new Set(regions);
		const previousZoneSet = new Set(previousZones.map((previous) => previous.toLowerCase()));
		const enteredZones = regions.filter((current) => !previousZoneSet.has(current.toLowerCase()));
		const leftZones = previousZones.filter((previous) => !currentZones.has(previous));
		for (const enteredZone of enteredZones)
		{
			const triggerCard = this.homey.flow.getDeviceTriggerCard('entered_zone');
			await triggerCard.trigger(this, { zone: enteredZone }, { zone: enteredZone });
			await this.homey.app.triggerPersonZoneEvent('entered', this.getName(), enteredZone);
		}
		for (const leftZone of leftZones)
		{
			const triggerCard = this.homey.flow.getDeviceTriggerCard('left_zone');
			await triggerCard.trigger(this, { zone: leftZone }, { zone: leftZone });
			await this.homey.app.triggerPersonZoneEvent('left', this.getName(), leftZone);
		}

		if (typeof location.battery === 'number')
		{
			await this.setCapabilityValue('measure_battery', location.battery).catch(this.error);
		}

		await this.setStoreValue('lastLocation', {
			lat: location.lat,
			lon: location.lon,
			accuracy: location.accuracy,
			timestamp: location.timestamp,
		}).catch(this.error);

		if (location.topic)
		{
			await this.setStoreValue('lastTopic', location.topic).catch(this.error);
		}

		if (location.trackerId)
		{
			await this.setStoreValue('lastTrackerId', location.trackerId).catch(this.error);
		}

		await this._recordTrackPoint(location).catch(this.error);
		this.homey.api.realtime('tracks_updated', null);
	}

	/**
	 * Appends a track point when the user has moved significantly (>= TRACK_MIN_DISTANCE_METERS)
	 * since the last recorded point, capping the stored history to TRACK_MAX_POINTS, and pushes
	 * a realtime update for the settings page's Map tab.
	 * @param {{ lat?: number, lon?: number, timestamp?: number }} location
	 */
	async _recordTrackPoint(location)
	{
		if (typeof location.lat !== 'number' || typeof location.lon !== 'number')
		{
			return;
		}

		const track = this.getStoreValue('track') || [];
		const last = track[track.length - 1];
		const moved = !last || distanceMeters(last.lat, last.lon, location.lat, location.lon) >= TRACK_MIN_DISTANCE_METERS;

		if (!moved)
		{
			return;
		}

		track.push({ lat: location.lat, lon: location.lon, timestamp: location.timestamp || Date.now() });
		while (track.length > TRACK_MAX_POINTS)
		{
			track.shift();
		}

		await this.setStoreValue('track', track);
	}

	/**
	 * Reads the "Presence zones" setting into a lowercased list, defaulting to ["home"].
	 * @returns {string[]}
	 */
	_getPresenceZones()
	{
		const raw = this.getSetting('presenceZones');
		const zones = (raw || '')
			.split(',')
			.map((zone) => zone.trim().toLowerCase())
			.filter(Boolean);

		return zones.length ? zones : ['home'];
	}

	/**
	 * Builds this user's OwnTracks "card" (name + avatar) and last known "location" entries,
	 * used to populate every location report's response so all users see each other on the map.
	 * @returns {Promise<object[]>}
	 */
	async getFriendPayload()
	{
		const topic = this.getStoreValue('lastTopic');
		const topicDevice = topic && topic.split('/').filter(Boolean).pop();
		const tid = this.getStoreValue('lastTrackerId') || (topicDevice && topicDevice.slice(-2).toUpperCase()) || this.getUserId().slice(-2).toUpperCase();
		const entries = [];

		const face = await this.getAvatarBase64();
		if (face)
		{
			entries.push({ _type: 'card', name: this.getName(), tid, face });
		}

		const lastLocation = this.getStoreValue('lastLocation');
		if (lastLocation && typeof lastLocation.lat === 'number')
		{
			entries.push({
				_type: 'location',
				tid,
				lat: lastLocation.lat,
				lon: lastLocation.lon,
				acc: lastLocation.accuracy,
				tst: Math.round((lastLocation.timestamp || Date.now()) / 1000),
			});
		}

		return entries;
	}

	/**
	 * Returns this user's uploaded avatar as base64 (set via the app settings page), or null.
	 * @returns {Promise<string|null>}
	 */
	async getAvatarBase64()
	{
		return this.getStoreValue('avatarBase64') || null;
	}

	/**
	 * Stores an uploaded avatar image (base64, no data-URI prefix) directly on the device.
	 * @param {string} base64
	 */
	async setUploadedAvatar(base64)
	{
		await this.setStoreValue('avatarBase64', base64);
	}

};
