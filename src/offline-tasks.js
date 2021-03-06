(function (manager) {
	'use strict';

	var context = window || {};
	if(typeof define === 'function' && define.amd) {
		//AMD
		define(manager);
	} else if (typeof exports === 'object') {
		//CommonJS
		module.exports = manager();
	} else {
		//Globals
		window.OfflineTasks = manager();
	}
}(function () {

	var Class = function () {};
	Class.inherit = Object.create || function (proto) {
		function F () {}
		F.prototype = proto;
		return new F();
	};
	Class.extend = function (props) {
		if(!props) return this;

		function Constructor () {
			this.init && this.init.apply(this, arguments);
		}
		Constructor.prototype = Class.inherit(this.prototype);
		Constructor.prototype.constructor = Constructor;
		Constructor.extend = Class.extend;

		for(var name in props) {
			if(props.hasOwnProperty(name)) {
				Constructor.prototype[name] = props[name];
			}
		}

		return Constructor;
	};

	var objectKeys = Object.keys || function (obj) {
		var result = [];
		for(var key in obj) {
			if(obj.hasOwnProperty(key)) {
				result.push(key);
			}
		}
		return result;
	};


	function isArray (obj) {
		return Object.prototype.toString.apply(obj) === '[object Array]'

	}

	function isFunction (obj) {
		return typeof obj === 'function';
	}

	function isBoolean (obj) {
		return Object.prototype.toString.apply(obj) === '[object Boolean]'
	}

	function isPlainObject(obj) {
		if (!obj || Object.prototype.toString.call(obj) !== '[object Object]' || obj.nodeType || obj.setInterval)
			return false;

		var has_own_constructor = obj.hasOwnProperty('constructor');
		var has_is_property_of_method = obj.hasOwnProperty.call(obj.constructor.prototype, 'isPrototypeOf');
		// Not own constructor property must be Object
		if (obj.constructor && !has_own_constructor && !has_is_property_of_method)
			return false;

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own.
		var key;
		for ( key in obj ) {}

		return key === undefined || obj.hasOwnProperty( key );
	};

	var EventListener = Class.extend({
		init: function () {
			this.events = {};
		},

		on: function (eventName, callback) {
			if(!this.events[eventName]) 
				this.events[eventName] = [];

			var events = this.events[eventName];
			if(events.indexOf(callback) < 0) {
				this.events[eventName].push(callback);
			}
		},

		off: function (eventName, callback) {
			var events = this.events[eventName];
			if(events) {
				var idx = events.indexOf(callback);
				events.splice(idx, 1);
			}
		},

		_fire: function (eventName) {
			var events = this.events[eventName];
			if(!events) return;
			var args = Array.prototype.slice.call(arguments, 1);
			for(var i = 0; i < events.length; i++) {
				events[i](args);
			}
		}
	});

	/**
	 * Prefix from key
	 * @type {string}
	 * @const
	 */
	var KEY = 'offline_tasks';

	/**
	 * Key from Keys array
	 * @type {string}
	 * @const
	 */
	var KEYS_NAME = 'keys';

	/**
	 * events: on:connection:open, on:task:complete, on:tasks:allowed
	 * @class OfflineTasks
	 */
	var OfflineTasks = EventListener.extend({
		/**
		 * @param {Object} params
		 *        {Object} params.provider
		 *        {Function} params.connectionTest
		 *        {Boolean} params.autorun
		 *        {integer} [params.timeout]
		 */
		init: function (params) {
			if(!params.provider)
				throw 'provider can not be undefined';
			if(!params.connectionTest)
				throw 'connectionTest can not be undefined';

			EventListener.prototype.init.apply(this, params);

			this.provider = params.provider;
			this.test = params.connectionTest;
			this.tick = params.timeout || 10000;
			this.autorun = params.autorun || false;
			this.connectionState = false;
			this.tasks = null;
			this.timeout = null;
			this.saveManagers = {};
			this._curKeys = {};
		},

		/**
		 * Check connection
		 * @param {Function} callback
		 * @returns {Boolean}
		 */
		checkConnection: function (callback) {
			var self = this;
			var fn = function (e, status) {
				self.connectionState = status !== 'error';
				self.connectionState && self._fire('on:connection:open');
				callback && callback(e, status);
			};
			var result = this.test(fn);
			this.connectionState  = false;
			if(isBoolean(result)){
				fn(null, result === true ? 'success' : 'error');
			}
			return result;
		},

		/**
		 * Get provide key from task key
		 * @returns {string}
		 * @private
		 */
		_getTaskKeys: function () {
			return this.provider.getItem(this._getKey(KEYS_NAME)) || [];
		},

		_getKey: function (key) {
			return KEY + '_' + key;
		},

		_loadKeys: function (keys) {
			var i = 0;
			keys = this._wrapIfNotArray(keys);
			for(; i < keys.length; i++) {
				this._curKeys[keys[i]] = true;
			}

			return objectKeys(this._curKeys);
		},

		_wrapIfNotArray: function (obj, callback) {
			if(!isArray(obj)) {
				obj = [obj];
				callback && callback();
			}

			return obj;
		},

		/**
		 * Check tasks in provider
		 * @returns {boolean}
		 */
		hasTasks: function () {
			var keys = this._getTaskKeys();
			var result = !!(keys && keys.length);

			if(result) {
				this._fire('on:tasks:allowed', keys);
			}

			return result;
		},

		/**
		 * Load tasks from provider by keys
		 * @param {Array | string} keys
		 */
		load: function (keys) {
			var keysArray = this._getTaskKeys();
			var loadOne = false;
			if(!keysArray || !keysArray.length) return null;
			if(!keys) keys = keysArray;

			keys = this._wrapIfNotArray(keys, function () {
				loadOne = true;
			});

			this.tasks = {};
			for(var i = 0; i < keys.length; i++) {
				if (keysArray === keys || !!~keysArray.indexOf(keys[i])) {
					this.tasks[keys[i]] = this.provider.getItem(this._getKey(keys[i]));
				}
			}
			return !loadOne ? this.tasks : this.tasks [keys[0]];
		},

		/**
		 * Save task with provider
		 * @param {string|object} key
		 * @param {Object | Array | Boolean} data
		 * @param {Boolean} [isRewrite]
		 */
		save: function (key, data, isRewrite) {
			var hasKeys = null;
			if(isPlainObject(key)) {
				hasKeys = this._saveKeys(objectKeys(key));
				isRewrite = data;
				data = null;
				this._saveMany(key, isRewrite ? hasKeys : null);
			} else {
				hasKeys = this._saveKeys(key);
				this._saveOne(key, data, isRewrite ? hasKeys : null);
			}

			if(this.autorun) this.run(key);
		},

		_saveKeys: function (keys) {
			var curKeys = this._getTaskKeys();
			var hasKeys = {};
			var key = null;
			keys = this._wrapIfNotArray(keys);

			for(var i = 0; i < keys.length; i++) {
				key = keys[i];
				if(!!~curKeys.indexOf(key)) {
					hasKeys[key] = true;
				} else {
					curKeys.push(key);
				}
			}

			this.provider.setItem(this._getKey(KEYS_NAME), curKeys);
			return hasKeys;
		},

		_saveMany: function (items, rewritingKeys) {
			for (var item in items) {
				if(items.hasOwnProperty(item)) {
					this._saveOne(item, items[item], rewritingKeys);
				}
			}
		},

		_saveOne: function (key, data, rewritingKeys) {
			var storageKey = this._getKey(key);

			data = this._wrapIfNotArray(data);

			if(!rewritingKeys || !rewritingKeys[key]) {
				var cur = this.provider.getItem(storageKey) || [];
				data = cur.concat(data);
			}

			if(this.tasks) this.tasks[key] = data;

			this.provider.setItem(storageKey, data);
		},

		/**
		 * Remove task by key
		 * @param {string} key
		 * @param {Number} [index]
		 */
		remove: function (key, index) {
			var keys = this._getTaskKeys();
			if(index && typeof index === 'number') {
				this.tasks[key][index] = '';
				this.provider.setItem(self._getKey(key), this.tasks[key]);
			} else {
				var idx = keys.indexOf(key);
				if(idx < 0) return null;
				keys.splice(idx, 1);
				delete this._curKeys[key];
				if(this.tasks) this.tasks[key] = null;
				this.provider.setItem(this._getKey(KEYS_NAME), keys);
				this.provider.removeItem(this._getKey(key));
			}
		},

		/**
		 * Run saved tasks
		 * @param {Array | string} keys
		 */
		run: function (keys) {
			var self = this;
			var fnOnConnection = null;

			clearTimeout(self.timeout);

			keys = keys || this._getTaskKeys();
			keys = this._loadKeys(keys);

			if(!keys || !keys.length) return;

			fnOnConnection = function () {
				if(self.connectionState) {
					self._runProcess(keys);
				} else {
					self.timeout = setTimeout(self.run.bind(self, keys), self.tick);
				}
			};

			this.checkConnection(fnOnConnection);
		},

		/**
		 * Save task process
		 * @param {Array} keys
		 * @private
		 */
		_runProcess: function (keys) {
			var self = this;
			var key = null;
			var saveManager = null;
			var fnSave = null;

			if(!this.tasks && !this.load(keys)) return;

			var fnDone = function (task, index) {
				var count = 0;
				var length = self.tasks[task].length;
				return function (status) {
					if(status !== 'error' || !status) {
						count++;
						index = count >= length ? null : index;
						self.remove(task, index);
						!index && self._fire('on:task:complete', task);
					}
				}
			};

			for(var i = 0; i < keys.length; i++) {
				key = keys[i];
				if(!this.tasks[key] || !(saveManager = this.saveManagers[key])) continue;
				fnSave = isFunction(saveManager) ? saveManager : saveManager.save.bind(saveManager);
				var tasks = this.tasks[key];
				for(var j = 0; j < tasks.length; j++) {
					if(tasks[j]) {
						fnSave(tasks[j], fnDone(key, j));
					}
				}
			}
		},

		/**
		 * Registration Task Manager
		 * @param {Array | Object} keys - Array of keys or Map(key: Object|Function(return Object))
		 * @param {Object | Function} [manager] - manager for key task. Function should receive 2 parameters: task, function done (e, status)
		 */
		saveManagerRegistry: function (keys, manager) {
			if(manager) {
				this.saveManagers[keys] = manager;
			} else {
				for(var k in keys) {
					if(!keys.hasOwnProperty(k)) continue;
					this.saveManagers[k] = keys[k];
				}
			}
			return this;
		}
	});

	return OfflineTasks;
}));