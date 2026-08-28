'use strict';

const EventEmitter = require('events');

/**
 * Common interface shared by the MQTT and HTTP OwnTracks connectors.
 * Emits a 'location' event with a normalized location object whenever
 * an OwnTracks location report is received.
 */
class BaseConnector extends EventEmitter
{

	constructor(homey)
	{
		super();
		this.homey = homey;
	}

	/** @returns {Promise<void>} */
	async connect()
	{
		// Nothing to do by default, override where needed.
	}

	/** @returns {Promise<void>} */
	async disconnect()
	{
		// Nothing to do by default, override where needed.
	}

}

module.exports = BaseConnector;
