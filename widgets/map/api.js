'use strict';

const { fetchTileBuffer } = require('../../lib/mapImage');

module.exports = {

	/**
	 * Returns every paired user's avatar, last location and recent journeys, plus the zones and
	 * the users this widget instance has hidden.
	 */
	async getData({ homey, query })
	{
		return homey.app.getWidgetMapData(query.instanceId);
	},

	/**
	 * Returns a visible widget-map tile through the app's identified, cached OSM client.
	 */
	async getMapTile({ params })
	{
		const zoom = Number(params.zoom);
		const tileX = Number(params.tileX);
		const tileY = Number(params.tileY);
		if (!Number.isInteger(zoom) || !Number.isInteger(tileX) || !Number.isInteger(tileY) || zoom < 0 || zoom > 19)
		{
			throw new Error('Invalid map tile coordinates');
		}

		const buffer = await fetchTileBuffer(zoom, tileX, tileY);
		if (!buffer) throw new Error('Map tile is outside the supported range');
		return { data: buffer.toString('base64') };
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
