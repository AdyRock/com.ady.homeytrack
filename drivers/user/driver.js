'use strict';

const Homey = require('homey');

module.exports = class UserDriver extends Homey.Driver
{

	async onInit()
	{
		const autocompleteZones = async (query, args) =>
		{
			const search = String(query || '').toLowerCase();
			const deviceId = args && args.device && args.device.getData().id;
			return this.homey.app.listWaypoints(deviceId)
				.filter((waypoint) => waypoint.desc.toLowerCase().includes(search))
				.map((waypoint) => ({ name: waypoint.desc, id: waypoint.desc }));
		};
		for (const cardId of ['entered_zone', 'left_zone', 'zone_changed'])
		{
			const triggerCard = this.homey.flow.getDeviceTriggerCard(cardId);
			triggerCard.registerArgumentAutocompleteListener('zone', autocompleteZones);
		}

		const conditionCard = this.homey.flow.getConditionCard('zone_is');
		conditionCard.registerArgumentAutocompleteListener('zone', autocompleteZones);
		conditionCard.registerRunListener(async (args) =>
		{
			const currentZoneValue = args.device.getCapabilityValue('zone');
			const currentZones = String(Array.isArray(currentZoneValue) ? currentZoneValue.join(',') : currentZoneValue || '')
				.split(',')
				.map((zone) => zone.trim().toLowerCase())
				.filter(Boolean);
			const selectedZoneValue = args.zone && typeof args.zone === 'object' ? (args.zone.id || args.zone.name) : args.zone;
			const selectedZone = String(selectedZoneValue || '').trim().toLowerCase();
			return currentZones.includes(selectedZone);
		});
	}

	async onPair(session)
	{
		let pairDetails = { name: null, userId: null };
		let deviceCreated = false;

		session.setHandler('getHomeyId', async () => this.homey.cloud.getHomeyId());
		session.setHandler('getImportedUsers', async () => this.homey.app.listImportedUsers());
		session.setHandler('setPairDetails', async (details) =>
		{
			pairDetails = details;
		});
		session.setHandler('getPairSetup', async () => ({
			connectionMethod: this.homey.settings.get('connectionMethod') || 'http',
			deviceCreated,
			...pairDetails,
		}));
		session.setHandler('setPairDeviceCreated', async () =>
		{
			deviceCreated = true;
		});
	}

};
