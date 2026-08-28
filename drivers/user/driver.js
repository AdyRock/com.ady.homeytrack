'use strict';

const Homey = require('homey');

module.exports = class UserDriver extends Homey.Driver {

	async onPair(session) {
		session.setHandler('getHomeyId', async () => this.homey.cloud.getHomeyId());
	}

};
