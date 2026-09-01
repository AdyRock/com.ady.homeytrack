'use strict';

module.exports = {

	/**
	 * Receives an OwnTracks HTTP mode location report.
	 * Configure the OwnTracks app to POST to this endpoint when using HTTP mode.
	 */
	async events({ homey, body, params })
	{
		homey.app.handleOwnTracksHttp(body, { user: params.userId });
		// OwnTracks expects a JSON array in the response; returning every known user's
		// card (name/avatar) and last location lets all family members' apps show each
		// other on the map. An object like `{ ok: true }` fails to parse on the device
		// with "failed to parse JSON".
		return homey.app.buildFriendsResponse(params.userId);
	},

	/**
	 * Used by the settings page to list paired users for the avatar upload UI.
	 */
	async getUsers({ homey })
	{
		return homey.app.listUsers();
	},

	/**
	 * Used by the settings page's Map tab to show every user's last location and track history.
	 */
	async getTracks({ homey })
	{
		return homey.app.listTracks();
	},

	async deleteJourney({ homey, body })
	{
		return homey.app.deleteJourney(body.userId, body.start, body.end);
	},

	async deleteTrackPoint({ homey, body })
	{
		return homey.app.deleteTrackPoint(body.userId, body.timestamp, body.lat, body.lon);
	},

	/**
	 * Used by the settings page to upload an avatar image (base64, no data-URI prefix) for a paired user.
	 */
	async setAvatar({ homey, body })
	{
		await homey.app.setUserAvatar(body.userId, body.imageBase64);
		return { ok: true };
	},

	async getSettingsBackup({ homey })
	{
		return homey.app.createSettingsBackup();
	},

	async restoreSettingsBackup({ homey, body })
	{
		return homey.app.restoreSettingsBackup(body);
	},

	/**
	 * Used by the settings page to list zones/waypoints (shared across all users).
	 */
	async getWaypoints({ homey })
	{
		return homey.app.listMapWaypoints();
	},

	async getWaypointConfiguration({ homey })
	{
		return homey.app.listWaypointConfiguration();
	},

	/**
	 * Used by the settings page to add or update a zone/waypoint.
	 */
	async addWaypoint({ homey, body })
	{
		homey.app.addWaypoint(body.waypoint || body, body.scope, body.userId);
		return { ok: true };
	},

	async updateWaypoint({ homey, body })
	{
		homey.app.updateWaypoint(body.id || body.originalDesc, body.waypoint, body.scope, body.userId);
		return { ok: true };
	},

	async removeScopedWaypoint({ homey, body })
	{
		homey.app.removeWaypoint(body.id, body.scope, body.userId);
		return { ok: true };
	},

	async setSharedWaypointEnabled({ homey, body })
	{
		homey.app.setSharedWaypointEnabled(body.userId, body.waypointId, body.enabled);
		return { ok: true };
	},

	async movePrivateWaypointToShared({ homey, body })
	{
		homey.app.movePrivateWaypointToShared(body.userId, body.waypointId);
		return { ok: true };
	},

	async copyPrivateWaypoint({ homey, body })
	{
		homey.app.copyPrivateWaypoint(body.sourceUserId, body.waypointId, body.destinationUserIds, body.conflict);
		return { ok: true };
	},

	/**
	 * Used by the settings page to remove a zone/waypoint by name.
	 */
	async deleteWaypoint({ homey, params })
	{
		homey.app.removeWaypoint(params.desc);
		return { ok: true };
	},

	/**
	 * Used by the settings page to show whether the connector (MQTT or HTTP) is connected.
	 */
	async getConnectionStatus({ homey })
	{
		return homey.app.getConnectionStatus();
	},

	/**
	 * Used by the settings page's Logs tab to show the last ~20KB of logged messages.
	 */
	async getLogs({ homey })
	{
		return { text: homey.app.getLogsText() };
	},

	/**
	 * Used by the settings page's Logs tab to empty the log buffer.
	 */
	async clearLogs({ homey })
	{
		homey.app.clearLogs();
		return { ok: true };
	},

	/**
	 * Used by the settings page's Logs tab to email the current log buffer.
	 */
	async emailLogs({ homey })
	{
		await homey.app.emailLogs();
		return { ok: true };
	},

};
