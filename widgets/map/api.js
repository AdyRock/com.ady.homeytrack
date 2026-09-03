'use strict';

module.exports = {

	/**
	 * Returns every paired user's avatar, last location and recent track, plus the zones and
	 * the users this widget instance has hidden.
	 */
	async getData({ homey, query })
	{
		return homey.app.getWidgetMapData(query.instanceId, query.trackHours);
	},

	/**
	 * Toggles a user on/off for this widget instance when its avatar is tapped.
	 */
	async setVisibility({ homey, body })
	{
		return homey.app.setWidgetUserVisibility(body.instanceId, body.userId, Boolean(body.visible));
	},

	/**
	 * Toggles the track lines and journey flags on/off for this widget instance.
	 */
	async setTracksVisibility({ homey, body })
	{
		return homey.app.setWidgetTracksVisible(body.instanceId, Boolean(body.visible));
	},

};
