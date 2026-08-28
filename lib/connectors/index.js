'use strict';

const MqttConnector = require('./MqttConnector');
const HttpConnector = require('./HttpConnector');

const CONNECTION_METHOD_MQTT = 'mqtt';
const CONNECTION_METHOD_HTTP = 'http';

/**
 * Builds the connector matching the app's currently configured connection method.
 * @param {import('homey').default} homey The Homey app instance.
 * @returns {MqttConnector|HttpConnector}
 */
function createConnector(homey)
{
	const method = homey.settings.get('connectionMethod') || CONNECTION_METHOD_HTTP;

	if (method === CONNECTION_METHOD_MQTT)
	{
		return new MqttConnector(homey, {
			brokerUrl: homey.settings.get('mqttBrokerUrl'),
			port: homey.settings.get('mqttPort'),
			username: homey.settings.get('mqttUsername'),
			password: homey.settings.get('mqttPassword'),
			useTls: Boolean(homey.settings.get('mqttUseTls')),
		});
	}

	return new HttpConnector(homey);
}

module.exports = {
	createConnector,
	CONNECTION_METHOD_MQTT,
	CONNECTION_METHOD_HTTP,
};
