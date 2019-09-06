/**
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.hosLogImporter = function(api, state) {
    'use strict';
    let container = document.getElementById('hosLogImporter'),
		dateContainer = document.getElementById("fromDate"),
		targetDatabase = document.getElementById("targetDatabase"),
		errorMessageTimer,
		minDate,
		deviceCache = {},
		trailerCache = {},
		userCache = {},
		
		
        initialize = function(userName, nextButton) {
			//Set up UI elements
			let copyBar = document.getElementById("copyBar"),
				hosProgressTextDiv = document.getElementById("hosCopyProgressText"),
				hosProgressBarDiv = document.getElementById("hosCopyProgressBar");
			copyBar.style.width = 0;
			copyBar.innerHTML = "0%"
			hosProgressTextDiv.style.display = "none";
			hosProgressBarDiv.style.display = "none";
			nextButton.style.display = "block";
			nextButton.disabled = true;
			minDate = new Date(new Date().setDate(new Date().getDate() - 7));
			minDate.setHours(0);
			minDate.setMinutes(0);
			minDate.setSeconds(0);
			dateContainer.min = minDate.toISOString().substr(0, 19);
			api.getSession(async function(session, server) {
				userName = session.userName;
                session["server"] = server;
				//Pull device, user and trailer information into cache
                let rawData = await utilities.hosSetup(session),
					hosAppCache = utilities.hosCopyBuildCache(rawData);
				populateSelectBox(rawData);
				deviceCache = hosAppCache.tempDeviceCache;
				trailerCache = hosAppCache.tempTrailerCache;
				userCache = hosAppCache.tempUserCache;
				nextButton.disabled = false;			
            });
        },
		
        focus = function() {
            container.className = '';
        },
		
		copyExecute = async function(userName, nextButton, restartButton) {
			let dateValue = new Date(dateContainer.value).toISOString(),
				currentDate = new Date().toISOString(),
				drivers = getSelectedDrivers(),
				userPassword = document.getElementById("hosUserPassword");
			if (drivers.length == 0 || targetDatabase.value === '' || dateContainer.value === '') {
				errorHandler("One or more field(s) are missing!");
			} else if (dateValue < minDate.toISOString() || dateValue > currentDate) {
				errorHandler("The date specified is outside the allowable range of " + minDate.toISOString() + " and " + currentDate + "!");
			} else if (drivers.length > 5) {
				errorHandler("You can only import logs for a maximum of five drivers at once!");
			} else {
				let fromDate = dateContainer.value,
					hosSourceLogs = await utilities.hosCopyGrabHosLogs(drivers, dateValue),
					targetSession = await utilities.hosCopyAuthenticate(htmlEscape(targetDatabase.value), userName, userPassword.value),
					sourceAnnotations = await utilities.hosCopyGrabAnnotations(hosSourceLogs),
					userRuleSets = await utilities.hosGrabUserRuleSet(drivers, dateValue);
				if (!hosSourceLogs.every(isEmpty)) {
					if (targetSession.credentials) {
						nextButton.disabled = true;
						let	targetCreds = {
							"database": targetSession.credentials.database,
							"userName": targetSession.credentials.userName,
							"sessionId": targetSession.credentials.sessionId,
							"server": targetSession.path
						},
						targetDatabaseCache = await utilities.hosTargetDatabaseBuildCache(targetCreds);
						utilities.hosUpdateCache(targetDatabaseCache.result);
						hosSourceLogs = utilities.hosSortAscending(hosSourceLogs);
						let analysisResults = utilities.hosAnalyzeLogs(hosSourceLogs, drivers),
							sanitizedLogs = analysisResults[0],
							rejectedUsers = analysisResults[1],
							acceptedUsers = analysisResults[2],
							attachedTrailers = await utilities.hosCopyGrabAttachedTrailers(acceptedUsers, fromDate),
							deviceList = utilities.hosGrabDeviceList(hosSourceLogs);
						await utilities.hosProcessLogs(sanitizedLogs, targetCreds, rejectedUsers, acceptedUsers, sourceAnnotations, userRuleSets);
						await utilities.hosProcessTrailers(attachedTrailers, targetCreds);
						nextButton.style.display = "none";
						restartButton.style.display = "block";
						restartButton.disabled = false;
					}
					else {
						errorHandler("Invalid credentials!");
					}
				} else {
					errorHandler("There are no logs to be imported.");
				}	
			}
		},
		
		copyCheckSessionUrl = function(server) {
			let regex = server,
				stringCheck = regex.search("https://"),
				postURL;
				
			if (stringCheck === -1) {
				postURL = "https://" + server + "/apiv1";
			} else {
				postURL = server + "apiv1";
			}
			return postURL;
		},
		
		copyProgress = function(width, itemNumber, iteration) {
			let copyBar = document.getElementById("copyBar"),
				widthIncrement = Math.round((100/(itemNumber)) * 100) / 100;
			width += widthIncrement;
			copyBar.style.width = width + '%';
			copyBar.innerHTML = width * 1 + '%';
			iteration++;
			if (iteration == itemNumber) {
				copyBar.style.width = '100%';
				copyBar.innerHTML = '100%';
				width = 0;	
			}
			return [width, iteration];
		},
		
		populateSelectBox = function(rawData) {
			let driverList = document.getElementById("hosDrivers");
			driverList.options.length = 0;
			for (let userIndex = 0; userIndex < rawData[1].length; userIndex++) {
				let hosOption = document.createElement("option");
				hosOption.text = rawData[1][userIndex].name;
				hosOption.id = rawData[1][userIndex].id;
				driverList.add(hosOption);
			}
		},
		
		errorHandler = function(msg) {
			let alertError = document.getElementById("hosErrorText");
			alertError.textContent = msg;
			alertError.classList.remove("hidden");
			clearTimeout(errorMessageTimer);
			errorMessageTimer = setTimeout(function () {
				alertError.classList.add("hidden");
			}, 6000);
		},
		
		isEmpty = function(logList) {
			return logList.length < 1;
		},
		
		getKeyByNameValue = function(object, value) {
			return Object.keys(object).find(function(key) {
				return object[key].name === value;
			});
		},
		
		getKeyByIdValue = function(object, value) { 
			return Object.keys(object).find(function(key) {
				return object[key].targetId === value;
			});
		},
		
		getSelectedDrivers = function() {
			let driverList = document.getElementById("hosDrivers"),
				selectedDrivers = [],
				options = driverList && driverList.options,
				opt;
			for (let driverIndex = 0; driverIndex < options.length; driverIndex++) {
				opt = options[driverIndex];
				if (opt.selected) {
					selectedDrivers.push(opt.value || opt.text);
				}
			}
			return selectedDrivers;
		},
		
		htmlEscape = function (str) {
			return String(str || "")
				.replace(/&/g, "&amp;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#39;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
		},

        utilities = (function() {
            let credentialsSource = {},
                userTimeZone = '',
                hosSetup = async function(credentials) {
					let currentDate = new Date()
					const calls = [
						{
							"method": "Get",
							"params": {
								"typeName": "Device",
								"search": {
									"fromDate": currentDate.toISOString()
								}
							}
						},
						{
							"method": "Get",
							"params": {
								"typeName": "User",
								"search": {
									"isDriver": true
								}
							}
						},
						{
							"method": "Get",
							"params": {
								"typeName": "Trailer"
							}
						}
					];
					const setupResponse = await hosMultiCall(calls, credentials);
					return setupResponse.result;
				},
				hosMultiCall = function(calls, credentials) {
					return new Promise(function(resolve, reject) {
						let request = new XMLHttpRequest(),
							apiMethod = {
								"method": "ExecuteMultiCall",
								"params": {
									"calls": calls,
									"credentials": {
										"database": credentials.database,
										"userName": credentials.userName,
										"sessionId": credentials.sessionId
									}
								}
							}
						let postURL = copyCheckSessionUrl(credentials.server);
						request.open("POST", postURL, true);
						request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
						request.onreadystatechange = function() {
							if (request.readyState === 4) {
								if (request.status === 200) {
									let json = JSON.parse(request.responseText);
									resolve(json);
								} else {
									errorHandler(JSON.parse(request.responseText));
									reject();
								}
							}
						}
						request.send("JSON-RPC=" + encodeURIComponent(JSON.stringify(apiMethod)));
					})
				},
				hosCopyAuthenticate = function(database, userName, password) {
					return new Promise(function(resolve, reject) {
						let request = new XMLHttpRequest(),
							apiMethod = {
								"method": "Authenticate",
								"params": {
									"password": password,
									"database": database,
									"userName": userName
								}
							}
						request.open("POST", "https://mypreview.geotab.com/apiv1", true);
						request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
						request.onreadystatechange = function() {
							if (request.readyState === 4) {
								if (request.status === 200) {
									let json = JSON.parse(request.responseText);
									resolve(json.result);
								} else {
									errorHandler("Failed to authenticate. Please ensure you have entered the correct credentials and that you have access to this database.");
									resolve();
								}
							}
						}
						request.send("JSON-RPC=" + encodeURIComponent(JSON.stringify(apiMethod)));
					})
				},
				hosCopyGrabAttachedTrailers = function(drivers, fromDate) {
					return new Promise(function(resolve, reject) {
						let trailerCalls = [];
						for (let user in drivers) {
							let driverId = getKeyByNameValue(userCache, drivers[user]);
							trailerCalls.push([
								"Get", { typeName: "TrailerAttachment",
									search: {
										userSearch: {
											id: driverId
										},
										fromDate: fromDate
									}
								}
							])
						};
						api.multiCall(trailerCalls, function(result) {
							resolve(result);
						}, function(error) {
							errorHandler(error);
							reject();
						});
					});
				},
				hosCopyBuildCache = function(rawData) {
					let amalgamatedCache = {},
						tempDeviceCache = {},
						tempTrailerCache = {},
						tempUserCache = {};
					for (let device in rawData[0]) {
						tempDeviceCache[rawData[0][device].id] = {"name": rawData[0][device].name};
					}
					for (let user in rawData[1]) {
						tempUserCache[rawData[1][user].id] = {"name": rawData[1][user].name};
					}
					for (let trailer in rawData[2]) {
						tempTrailerCache[rawData[2][trailer].id] = {"name": rawData[2][trailer].name};
					}
					amalgamatedCache.tempDeviceCache = tempDeviceCache;
					amalgamatedCache.tempUserCache = tempUserCache;
					amalgamatedCache.tempTrailerCache = tempTrailerCache;
					return amalgamatedCache;
				},
				hosCopyGrabHosLogs = function(drivers, fromDate) {
					return new Promise(function(resolve, reject) {
						let hosLogCalls = [];
						for (let driverIndex = 0; driverIndex < drivers.length; driverIndex++) {
							let driverId = getKeyByNameValue(userCache, drivers[driverIndex]);
							hosLogCalls.push([
								"Get", { typeName: "DutyStatusLog", 
									search: {
										userSearch: {
											id: driverId
										},
										fromDate: fromDate
									}
								}
							])
						};
						api.multiCall(hosLogCalls, function(result) {
							resolve(result);
						}, function(error) {
							errorHandler(error);
							reject();
						});
					})
				},
				hosCopyGrabAnnotations = function(hosLogs) {
					return new Promise(function(resolve, reject) {
						let annotationCalls = [],
							annotationIdList = [];
						for (let driverIndex = 0; driverIndex < hosLogs.length; driverIndex++) {
							for (let logIndex = 0; logIndex < hosLogs[driverIndex].length; logIndex++) {
								if (hosLogs[driverIndex][logIndex].annotations) {
									for (let annotation = 0; annotation < hosLogs[driverIndex][logIndex].annotations.length; annotation++) {
										annotationIdList.push(hosLogs[driverIndex][logIndex].annotations[annotation])
										annotationCalls.push([
											"Get", { typeName: "AnnotationLog",
												search: {
													id: hosLogs[driverIndex][logIndex].annotations[annotation].id
												}
											}
										])
									}	
								}
							}
						}					
						
						api.multiCall(annotationCalls, function(result) {
							resolve(result);
						}, function(error) {
							errorHandler(error);
							reject();
						})
					})
				},
				hosGrabUserRuleSet = function(drivers, fromDate) {
					return new Promise(function(resolve, reject) {
						let rulesetCalls = [];
						for (let driverIndex = 0; driverIndex < drivers.length; driverIndex++) {
							let driverId = getKeyByNameValue(userCache, drivers[driverIndex]);
							rulesetCalls.push([
								"Get", { typeName: "UserHosRuleSet",
									search: {
										userSearch: {
											id: driverId
										},
										fromDate: fromDate
									}
								}
							])
						}
						
						api.multiCall(rulesetCalls, function(result) {
							let temp = result[0];
							for (let ruleIndex = 0; ruleIndex < temp.length; ruleIndex++) {
								delete temp[ruleIndex].id;
								delete temp[ruleIndex].version;
							}
							resolve(temp);
						}, function(error) {
							errorHandler(error);
							reject();
						})
					})
				},
				hosGrabDeviceList = function(logs) {
					let tempDeviceList = [];
					for (let log in logs) {
						if (logs[log].device) {
							if (tempDeviceList.indexOf(logs[log].device.id) === -1) {
								tempDeviceList.push(logs[log].device.id);
							}
						}
					}
					return tempDeviceList;
				},
				hosProcessTrailers = function(trailers, targetCreds) {
					return new Promise(async function(resolve, reject) {
						let addTrailerCalls = [],
							progressLabelText = document.getElementById("hosCopyProgressLabel");
						for (let attachments in trailers) {
							let curTrailer = trailers[attachments];
							for (let trailer in curTrailer) {
								let trailerId = trailerCache[curTrailer[trailer].trailer.id].targetId,
									deviceId = deviceCache[curTrailer[trailer].device.id].targetId;
								addTrailerCalls.push({
									"method": "Add", "params":
									{ 
										typeName: "TrailerAttachment",
										entity: {
											fromDate: curTrailer[trailer].activeFrom,
											toDate: "2050-01-01",
											device: { id: deviceId },
											trailer: { id: trailerId }
										}
									}
								})
							}
						}
						progressLabelText.innerHTML = "Importing trailer attachements...";
						await hosMultiCall(addTrailerCalls, targetCreds);
						progressLabelText.innerHTML = "Done!";
						resolve();
					})
				},
				hosTargetDatabaseBuildCache = async function(targetCreds) {
					return new Promise(async function(resolve, reject) {
						let currentDate = new Date()
						const calls = [
							{
								"method": "Get",
								"params": {
									"typeName": "Device",
									"search": {
										"fromDate": currentDate.toISOString()
									}
								}
							},
							{
								"method": "Get",
								"params": {
									"typeName": "User",
									"search": {
										"isDriver": true
									}
								}
							},
							{
								"method": "Get",
								"params": {
									"typeName": "Trailer"
								}
							}
						];
						const targetResponse = await hosMultiCall(calls, targetCreds);
						resolve(targetResponse);
					})
					
				},
				hosUpdateCache = function(data) {
					for (let device in data[0]) {
						let idList = [];
						for (let key in deviceCache) {
							if (deviceCache[key].name === data[0][device].name) {
								idList.push(key);
							}
						}
						let sourceDeviceId = getKeyByNameValue(deviceCache, data[0][device].name)
						if (typeof(sourceDeviceId) === 'undefined') {
							continue;
						} else {
							if (idList.length > 0) {
								for (let index = 0; index < idList.length; index++) {
									deviceCache[idList[index]]["targetId"] = data[0][device].id;
								}
							}
						}
					}
					for (let user in data[1]) {
						let sourceUserId = getKeyByNameValue(userCache, data[1][user].name);
						if (typeof(sourceUserId) === 'undefined') {
							continue;
						} else {
							userCache[sourceUserId]["targetId"] = data[1][user].id;
						}
					}
					for (let trailer in data[2]) {
						let sourceTrailerId = getKeyByNameValue(trailerCache, data[2][trailer].name);
						if (typeof(sourceTrailerId) === 'undefined') {
							continue;
						} else {
							trailerCache[sourceTrailerId]["targetId"] = data[2][trailer].id;
						}
					}
				},
				hosSortAscending = function(logs) {
					for (let index = 0; index < logs.length; index++) {
						logs[index].sort(function(a, b) {
							return new Date(a.dateTime) - new Date(b.dateTime);
						});
					}
					return logs;
				},
				hosAnalyzeLogs = function(logs, drivers) {
					let omitSet,
						counter = 0,
						sanitizedLogs = {},
						rejectedUsers = [],
						acceptedUsers = [];
					sanitizedLogs.rejected = [];
					sanitizedLogs.accepted = [];
					for (let dsl in logs) {
						omitSet = false;
						for (let log in logs[dsl]) {
							if (logs[dsl][log].device === "NoDeviceId") {
								continue;
							} else if (!deviceCache[logs[dsl][log].device.id].hasOwnProperty("targetId")) {
								omitSet = true;
								break;
							} 
						}
						if (omitSet || logs[dsl].length < 1) {
							sanitizedLogs.rejected.push(logs[dsl]);
							rejectedUsers.push(drivers[counter]);
						} else {
							sanitizedLogs.accepted.push(logs[dsl]);
							acceptedUsers.push(drivers[counter]);
						}
						counter++;
					}
					return [sanitizedLogs, rejectedUsers, acceptedUsers];
				},
				// Find the DSL that the annotation belongs to by comparing the Ids
				getById = function(array, index, value) {
					return array[index].findIndex(function(x) { 	
						return x.id === value;
					})
				}, 
				// Return the indices that will add the annotation into the corresponding DSL.
				findId = function(array, value) { 
					for (let index = 0; index < array.length; index++) {
						let location = getById(array, index, value);
						if (location !== -1) {
							return [index, location];
						}
					}
				},
				
				hosProcessLogs = async function(logs, targetCreds, rejectedUsers, acceptedUsers, annotations, rulesets) { 
					return new Promise(async function(resolve, reject) {
						if (logs.accepted.length > 0) {
							let progress = 0,
								iteration = 0,
								addRuleSetCalls = [],
								progressBar = document.getElementById("hosCopyProgressBar"),
								progressLabel = document.getElementById("hosCopyProgressText"),
								progressLabelText = document.getElementById("hosCopyProgressLabel");
							progressLabel.style.display = "block";
							progressBar.style.display = "block";
							for (let driver = 0; driver < logs.accepted.length; driver++) {
								for (let log = 0; log < logs.accepted[driver].length; log++) {
									if (logs.accepted[driver][log].annotations) {
										logs.accepted[driver][log].annotations = [];
									}
								}
							}
							for (let ruleIndex = 0; ruleIndex < rulesets.length; ruleIndex++) {
								if (acceptedUsers.includes(userCache[rulesets[ruleIndex].user.id].name)) {
									rulesets[ruleIndex].user.id = userCache[rulesets[ruleIndex].user.id].targetId;
									addRuleSetCalls.push({
										"method": "Add",
										"params": {
											typeName: "UserHosRuleSet",
											entity: rulesets[ruleIndex]
										}
									});
								}
							}
							// find which log has the id and then input the relevant details for the annotations
							for (let annotation = 0; annotation < annotations.length; annotation++) {
								let annIndices = findId(logs.accepted, annotations[annotation][0].dutyStatusLog.id);
								logs.accepted[annIndices[0]][annIndices[1]].annotations.push({
									"driver": {"id": annotations[annotation][0].driver.id}, 
									"comment": annotations[annotation][0].comment, 
									"dateTime": annotations[annotation][0].dateTime
								});
							};
							await hosMultiCall(addRuleSetCalls, targetCreds);
							for (let item in logs.accepted) {
								let userLogs = logs.accepted[item],
									addHosLogCalls = [];
								for (let log in userLogs) {
									userLogs[log].coDrivers = [];
									delete userLogs[log].eventCode;
									delete userLogs[log].eventRecordStatus;
									delete userLogs[log].eventType;
									delete userLogs[log].id;
									delete userLogs[log].origin;
									delete userLogs[log].sequence;
									delete userLogs[log].version;
									
									userLogs[log].driver.id = userCache[userLogs[log].driver.id].targetId;
									if (!(userLogs[log].device === "NoDeviceId")) {
										userLogs[log].device.id = deviceCache[userLogs[log].device.id].targetId;
									}
									addHosLogCalls.push({
										"method": "Add",
										"params": {
											typeName: "DutyStatusLog",
											entity: userLogs[log]
										}
									});
								};
								let progressBarData = copyProgress(progress, logs.accepted.length, iteration);
								progress = progressBarData[0];
								iteration = progressBarData[1];
								progressLabelText.innerHTML = "Copying " + acceptedUsers[item] + "'s logs...";
								await hosMultiCall(addHosLogCalls, targetCreds);
								progressLabelText.innerHTML = "Finished copying " + acceptedUsers[item] + "'s logs.";
							};
							if (logs.rejected.length > 0) {
								let userString = "";
								for (let i = 0; i < rejectedUsers.length; i++) {
									userString += rejectedUsers[i] + ", ";
								}
								userString = userString.slice(0, -2);
								errorHandler("The following users: " + userString + " do not have matching assets in target database or do not have HOS logs!");
							};
							resolve();
						} else {							
							errorHandler("Selected users do not have matching assets in target database!");
							resolve();
						}	
					})
				}
            return {
                hosSetup: hosSetup,
				hosCopyAuthenticate: hosCopyAuthenticate,
				hosCopyGrabAttachedTrailers: hosCopyGrabAttachedTrailers,
				hosCopyBuildCache: hosCopyBuildCache,
				hosCopyGrabHosLogs: hosCopyGrabHosLogs,
				hosCopyGrabAnnotations: hosCopyGrabAnnotations,
				hosGrabUserRuleSet: hosGrabUserRuleSet,
				hosGrabDeviceList: hosGrabDeviceList,
				hosProcessTrailers: hosProcessTrailers,
				hosTargetDatabaseBuildCache: hosTargetDatabaseBuildCache,
				hosUpdateCache: hosUpdateCache,
				hosSortAscending: hosSortAscending,
				hosAnalyzeLogs: hosAnalyzeLogs,
				hosProcessLogs: hosProcessLogs
            }
        })();
		
		// Simple Dialog Box Plugin by Taufik Nurrohman
		// URL: http://www.dte.web.id + https://plus.google.com/108949996304093815163/about
		// Licence: none

		(function(a, b) {

			var uniqueId = new Date().getTime();

			(function() { // Create the dialog box markup
				var div = b.createElement('div'),
					ovr = b.createElement('div');
					div.className = 'dialog-box-hos';
					div.id = 'dialog-box-hos-' + uniqueId;
					div.innerHTML = '<div class="dialog-title">&nbsp;</div><a href="javascript:;" class="dialog-minmax" title="Minimize">&ndash;</a><a href="javascript:;" class="dialog-close" title="Close">&times;</a><div class="dialog-content">&nbsp;</div><div class="dialog-action"></div>';
					ovr.className = 'dialog-box-hos-overlay';
				b.body.appendChild(div);
				b.body.appendChild(ovr);
			})();

			var maximize = false,
				dialog = b.getElementById('dialog-box-hos-' + uniqueId), // The HTML of dialog box
				dialog_title = dialog.children[0],
				dialog_minmax = dialog.children[1],
				dialog_close = dialog.children[2],
				dialog_content = dialog.children[3],
				dialog_action = dialog.children[4],
				dialog_overlay = dialog.nextSibling;

			a.setDialog = function(set, config) {

				var selected = null, // Object of the element to be moved
					x_pos = 0,
					y_pos = 0, // Stores x & y coordinates of the mouse pointer
					x_elem = 0,
					y_elem = 0, // Stores top, left values (edge) of the element
					defaults = {
						title: dialog_title.innerHTML,
						content: dialog_content.innerHTML,
						width: 400,
						height: 250,
						top: false,
						left: false,
						buttons: {
							"Yes": function() {
								clearInfo();
							},
							"Cancel": function() {
								setDialog('close');
							}
						},
						specialClass: "",
						fixed: false,
						overlay: true
					}; // Default options...

				for (var i in config) { defaults[i] = (typeof(config[i])) ? config[i] : defaults[i]; }

				// Will be called when user starts dragging an element
				function _drag_init(elem) {
					selected = elem; // Store the object of the element which needs to be moved
					x_elem = x_pos - selected.offsetLeft;
					y_elem = y_pos - selected.offsetTop;
				}

				// Will be called when user dragging an element
				function _move_elem(e) {
					x_pos = b.all ? a.event.clientX : e.pageX;
					y_pos = b.all ? a.event.clientY : e.pageY;
					if (selected !== null) {
						selected.style.left = !defaults.left ? ((x_pos - x_elem) + selected.offsetWidth/2) + 'px' : ((x_pos - x_elem) - defaults.left) + 'px';
						selected.style.top = !defaults.top ? ((y_pos - y_elem) + selected.offsetHeight/2) + 'px' : ((y_pos - y_elem) - defaults.top) + 'px';
					}
				}

				// Destroy the object when we are done
				function _destroy() {
					selected = null;
				}

				dialog.className =  "dialog-box-hos " + (defaults.fixed ? 'fixed-dialog-box ' : '') + defaults.specialClass;
				dialog.style.visibility = (set === "open") ? "visible" : "hidden";
				dialog.style.opacity = (set === "open") ? 1 : 0;
				dialog.style.width = defaults.width + 'px';
				dialog.style.height = defaults.height + 'px';
				dialog.style.top = (!defaults.top) ? "50%" : '0px';
				dialog.style.left = (!defaults.left) ? "50%" : '0px';
				dialog.style.marginTop = (!defaults.top) ? '-' + defaults.height/2 + 'px' : defaults.top + 'px';
				dialog.style.marginLeft = (!defaults.left) ? '-' + defaults.width/2 + 'px' : defaults.left + 'px';
				dialog_title.innerHTML = defaults.title;
				dialog_content.innerHTML = defaults.content;
				dialog_action.innerHTML = "";
				dialog_overlay.style.display = (set === "open" && defaults.overlay) ? "block" : "none";

				if (defaults.buttons) {
					for (var j in defaults.buttons) {
						var btn = b.createElement('a');
							btn.className = 'btn';
							btn.href = 'javascript:;';
							btn.innerHTML = j;
							btn.onclick = defaults.buttons[j];
						dialog_action.appendChild(btn);
					}
				} else {
					dialog_action.innerHTML = '&nbsp;';
				}

				// Bind the draggable function here...
				dialog_title.onmousedown = function() {
					_drag_init(this.parentNode);
					return false;
				};

				dialog_minmax.innerHTML = '&ndash;';
				dialog_minmax.title = 'Minimize';
				dialog_minmax.onclick = dialogMinMax;

				dialog_close.onclick = function() {
					setDialog("close", {content:""});
				};

				b.onmousemove = _move_elem;
				b.onmouseup = _destroy;

				maximize = (set === "open") ? true : false;

			};

			// Maximized or minimized dialog box
			function dialogMinMax() {
				if (maximize) {
					dialog.className += ' minimize';
					dialog_minmax.innerHTML = '+';
					dialog_minmax.title = dialog_title.innerHTML.replace(/<.*?>/g,"");
					maximize = false;
				} else {
					dialog.className = dialog.className.replace(/(^| )minimize($| )/g, "");
					dialog_minmax.innerHTML = '&ndash;';
					dialog_minmax.title = 'Minimize';
					maximize = true;
				}
			}

		})(window, document);

    return {
        initialize: function(api, state, initializeCallback) {
			let nextButton = document.getElementById("hosCopyNext"),
				restartButton = document.getElementById("hosCopyRestart"),
				helpButton = document.getElementById("hosHelpButton"),
				userName;
			api.getSession(function(session, server) {
				userName = session.userName;
			})
			restartButton.style.display = "none";
			nextButton.addEventListener("click", function() {
				copyExecute(userName, nextButton, restartButton);
			}, false);
			restartButton.addEventListener("click", async function() {
				restartButton.style.display = "none";
				initialize(userName, nextButton);
			});
			helpButton.addEventListener("click", function() {
				setDialog("open", {
					title: "Help",
					content: "This add-in allows you to copy HOS logs for your drivers from one database to another. Please select the drivers whose logs you would like to transfer. Please specify the target database and enter your password. The date specified cannot be further back than seven days. A maximum of five driver logs can be transferred at a time. <br><br><b>The driver and associated assets must be present in the source and target databases.</b>",
					buttons: {
						"Close": function() {
							setDialog('close');
						}
					}
				})
			}, false);
            initialize(userName, nextButton);
            // MUST call initializeCallback when done any setup
            initializeCallback();
        },
        focus: function(api, state) {
            focus();
        },
        blur: function() {}
    };
};