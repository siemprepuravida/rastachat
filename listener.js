var http = require('http');
var mysql = require('mysql');
var io = require('socket.io');
var moment = require('moment');
var winston = require('winston');
var pusage = require('pidusage');
var config = require('./config');
var stdin = process.openStdin();
var socket = io.listen(config.LISTENER_PORT);
var logger = require('./src/logger')(module);
var db = require('./src/db');

var wp_prefix = config.DB_CONFIG.DB_PREFIX;
var users = [];
var connection = 0;
var start_time = moment();
var ban_words = [];
var ban_words_list = [];

console.log(
	"--------------------------------------------------------------------------------\n" +
	"\t\t\t\x1b[32mLive Chat Listener\n\n\x1b[0m" + 
	"If you have any problems, feel free to contact.\n\n" +
	"\x1b[36m-help\x1b[0m to see all commands.\n\n" + 
	
	"\x1b[36mEmail:\x1b[0m\t\naimberktumer@gmail.com\n" +
	"\x1b[36mStart time:\x1b[0m\t" + start_time.format() + "\n" +
	"--------------------------------------------------------------------------------\n"
);

stdin.addListener("data", function(d) {
	var str = d.toString().trim();
	if(str == "-usage" || str == "-u") {
		pusage.stat(process.pid, function(err, stat) {			
			if(stat.memory < 1024) {
				var memory = parseFloat(stat.memory).toFixed(2) + "B";
			} else if(stat.memory < 1024 * 1024) {
				var memory = parseFloat(stat.memory / 1024).toFixed(2) + "K";
			} else if(stat.memory < 10124 * 1024 * 1024) {
				var memory = parseFloat(stat.memory / 1024 / 1024).toFixed(2) + "M";
			} else {
				var memory = parseFloat(stat.memory / 1024 / 1024 / 1024).toFixed(2) + "G";
			}
			
			var cpu = parseFloat(stat.cpu).toFixed(2);
			console.log(
				"\n" + 
				"CPU:\t\t" + cpu + "\n" +
				"Memory:\t\t" + memory + "\n\n" +
				"Start Time:\t" + start_time.format() + "\n" +
				"Uptime:\t\t" + (process.uptime() + "").toHHMMSS() + "\n"
			);
		});
	} else if(str == "-exit") {
		process.exit();
	} else if(str == "-connection" || str == "-c") {
		console.log("\nConnection:\t" + connection + "\n");
	} else if(str == "-help" || str == "-h") {
		console.log(
			"\n" +
			"-usage, -u\t\tShows the current resource usage\n" +
			"-connection, -c\t\tShows the number of connections\n" +
			"-exit\t\t\tKills the listener\n"
		);
	} else {
		console.log(
			"\n" +
			"Could not find the command.\n" +
			"-help to see all commands.\n"
		);
	}
});

db.query('SELECT val1, val2 FROM ' + wp_prefix + "simplychat_banned_words")
	.on('result', function(data){
		ban_words_list.push(data.val1.toLowerCase());
		ban_words.push(data.val2);
	});

socket.on("connection", function (client) {
	var friends = [];
	if (client.handshake.query.uid > 0 && socket.sockets.connected[client.id] != undefined) {
		socket.sockets.connected[client.id].emit("updateStatus");
		
		var uid = client.handshake.query.uid;
		var isAway = client.handshake.query.away;

        users[client.id] = uid;
		connection++;

		if(isAway == "true") {
			db.query("UPDATE "+wp_prefix+"simplychat_members SET `online`=2 WHERE `ID` = ?", [uid]);
		} else {
			db.query("UPDATE "+wp_prefix+"simplychat_members SET `online`=1 WHERE `ID` = ?", [uid]);
		}
		
		db.query('SELECT friend_user_id, initiator_user_id FROM ' + wp_prefix + "bp_friends WHERE (friend_user_id = ? || initiator_user_id = ?) && is_confirmed = 1", [uid, uid])
			.on('result', function(data){
                if(data.friend_user_id == uid) {
					var fid = data.initiator_user_id;
				} else {
					var fid = data.friend_user_id;
				}
                friends.push(fid);
				
				
            })
            .on('end', function(){
				findCidByFriends(friends, users).map(function(i) {
					updateOnlineFriends(users[i], isAway == "true" ? 'away' : 'online', uid, i);
				});
            });

    } else {
		return;
	}

    client.on("setAway", function(){
		var uid = users[client.id];
		
		db.query("UPDATE "+wp_prefix+"simplychat_members SET `online` = 2 WHERE `ID` = ? LIMIT 1", [uid]);
        findCidByFriends(friends, users).map(function(i) {
			updateOnlineFriends(users[i], 'away', uid, i);
		});
    });

    client.on("setOnline", function(){
		var uid = users[client.id];
		
		db.query("UPDATE "+wp_prefix+"simplychat_members SET `online` = 1 WHERE `ID` = ? LIMIT 1", [uid]);
        findCidByFriends(friends, users).map(function(i) {
			updateOnlineFriends(users[i], 'online', uid, i);
		});
    });

    client.on("disconnect", function(){
		var uid = users[client.id];
		
		db.query("UPDATE "+wp_prefix+"simplychat_members SET `online` = 0 WHERE `ID` = ? LIMIT 1", [uid]);
        findCidByFriends(friends, users).map(function(i) {
			updateOnlineFriends(users[i], 'offline', uid, i);
		});
		
        delete users[client.id];
		connection--;
    });
	
	client.on("textMessage", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);

			var hash = msg.hash;
			var uid = users[client.id];
			var uname = msg.uname;
			var photo = msg.photo;
			var message = msg.message;
			var type = msg.type;		
			
			var time = moment().unix();
			var lastID = -1;
			var isBanned = true;
			db.query('SELECT banned FROM '+wp_prefix+'simplychat_members WHERE ID = ?', [uid])
				.on('result', function(data){
					isBanned = data.banned == 1 ? true : false;
				})
				.on('end', function(){
					db.query("INSERT INTO "+wp_prefix+"simplychat_chat_messages(chat_room, message, from_id, from_name, time, type) VALUES (?, ?, ?, ?, ?, 'user')", [hash, message, uid, uname, time], function(err, result) {
						if(err) throw err;
						var members = [];

						db.query('SELECT user_id FROM '+wp_prefix+'simplychat_chat_members WHERE '+wp_prefix+'simplychat_chat_members.chat_room = ? && '+wp_prefix+'simplychat_chat_members.user_id != ?', [hash, uid])
							.on('result', function(data){
								members.push(data.user_id);
							})
							.on('end', function(){
								members.forEach(function(val, key) {
									db.query("INSERT INTO "+wp_prefix+"simplychat_chat_unread (chat_room, msg_id, usr_id) VALUES (?, ?, ?)", [hash, result.insertId, val]);
								});
							});
					});

					db.query("UPDATE "+wp_prefix+"simplychat_chat_room SET last_message_time = ? WHERE id_hash = ?", [time, hash])
					db.query("UPDATE "+wp_prefix+"simplychat_chat_members SET last_message_time = ? WHERE chat_room = ?", [time, hash])

					sendTextMsg(msg, uid, time, client.id);
				});
		}
    });
	
	client.on("fileMessage", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);

			var hash = msg.hash;
			var uid = users[client.id];
			var uname = msg.uname;
			var photo = msg.photo;
			var type = msg.type;
			
			var fileType = msg.fileType;
			var fileName = msg.fileName;
			var filePath = msg.filePath;
			var fileMime = (fileType == "user_media_vid" || fileType == "user_media_music" ? msg.fileMime : null);
			
			var time = moment().unix();
			var lastID = -1;
			var isBanned = true;
			db.query('SELECT banned FROM '+wp_prefix+'simplychat_members WHERE ID = ?', [uid])
				.on('result', function(data){
					isBanned = data.banned == 1 ? true : false;
				})
				.on('end', function(){
					db.query("INSERT INTO "+wp_prefix+"simplychat_chat_messages(chat_room, message, from_id, from_name, time, type, file_name, mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [hash, filePath, uid, uname, time, fileType, fileName, fileMime], function(err, result) {
						if(err) throw err;
						var members = [];

						db.query('SELECT user_id FROM '+wp_prefix+'simplychat_chat_members WHERE '+wp_prefix+'simplychat_chat_members.chat_room = ? && '+wp_prefix+'simplychat_chat_members.user_id != ?', [hash, uid])
							.on('result', function(data){
								members.push(data.user_id);
							})
							.on('end', function(){
								members.forEach(function(val, key) {
									db.query("INSERT INTO "+wp_prefix+"simplychat_chat_unread (chat_room, msg_id, usr_id) VALUES (?, ?, ?)", [hash, result.insertId, val]);
								});
							});
					});

					db.query("UPDATE "+wp_prefix+"simplychat_chat_room SET last_message_time = ? WHERE id_hash = ?", [time, hash])
					db.query("UPDATE "+wp_prefix+"simplychat_chat_members SET last_message_time = ? WHERE chat_room = ?", [time, hash])

					sendFileMsg(msg, uid, time, client.id);
				});
		}
    });
	
	client.on("inviteOnGroupCreation", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var uid = users[client.id];
			var isBanned = true;
			db.query('SELECT banned FROM '+wp_prefix+'simplychat_members WHERE ID = ?', [uid])
				.on('result', function(data){
					isBanned = data.banned == 1 ? true : false;
				})
				.on('end', function(){
					for(var i=0; i<msg.users.length; i++) {
						var usr = msg.users[i];

						var cid = clientID(usr);
						if(cid != false && socket.sockets.connected[cid] != undefined) {
							var result = {
								title: msg.title,
								photo: msg.chat_img,
								cid: msg.room,
								type: "group",
								members: msg.users.length + 1,
							};
									
							var json_result = JSON.stringify(result);
							socket.sockets.connected[cid].emit('joinGroup', json_result);
						}
					}
				});
		}
    });
	
	client.on("inviteGroup", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var cid = clientID(msg.uid);
			if(cid != false && socket.sockets.connected[cid] != undefined) {
				var result = {
					title: msg.title,
					photo: msg.chat_img,
					cid: msg.room,
					type: "group",
					members: msg.members,
				};

				var json_result = JSON.stringify(result);
				socket.sockets.connected[cid].emit('joinGroup', json_result);
			}
			notifyOnJoin(msg, client.id);
		}
    });
	
	client.on("kickUsers", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var userID = users[client.id];
			var isAdmin = false;
			var time = moment().unix();
	
			db.query('SELECT ID FROM ' + wp_prefix + "simplychat_group_admins WHERE chat_id = ? && user_id = ?", [msg.room, userID])
			.on('result', function(data){
                isAdmin = true;
            })
            .on('end', function(){
				if(isAdmin) {
					var cid = clientID(msg.uid);

					db.query("DELETE FROM "+wp_prefix+"simplychat_chat_members WHERE chat_room = ? && user_id = ?", [msg.room, msg.uid])
					db.query("DELETE FROM "+wp_prefix+"simplychat_group_admins WHERE chat_id = ? && user_id = ?", [msg.room, msg.uid])
					db.query("INSERT INTO "+wp_prefix+"simplychat_chat_messages (chat_room, message, from_id, from_name, time, type) VALUES (?, ?, ?, ?, ?, 'kicked')", [msg.room, msg.uname, msg.uid, msg.uname, time])

					if(cid != false && socket.sockets.connected[cid] != undefined) {
						var result = {
							title: msg.title,
							photo: msg.chat_img,
							cid: msg.room,
							type: "group",
						};

						var json_result = JSON.stringify(result);
						socket.sockets.connected[cid].emit('kicked', json_result);
					}
					notifyOnKick(msg, client.id);
				}
            });
		}
	});
	
	client.on("kickUsersAdmin", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var userID = users[client.id];
			var cid = clientID(msg.uid);

			if(cid != false && socket.sockets.connected[cid] != undefined) {
				var result = {
					title: msg.title,
					photo: msg.chat_img,
					cid: msg.room,
					type: "group",
				};

				var json_result = JSON.stringify(result);
				socket.sockets.connected[cid].emit('kicked', json_result);
			}
			notifyOnKick(msg, client.id);
		}
	});
	
	client.on("leaveChat", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			notifyOnLeave(msg);
		}
    });
	
	client.on("banned", function(data){
		if(users[client.id] > 0) {
			var cuid = users[client.id];
			var msg = JSON.parse(data);
			var cid = clientID(msg.uid);
			if(socket.sockets.connected[cid] != undefined)
				socket.sockets.connected[cid].emit('banned');
		}
    });
	
	client.on("joinPublicGroup", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var uid = users[client.id];
			var isBanned = true;
			db.query('SELECT banned FROM '+wp_prefix+'simplychat_members WHERE ID = ?', [uid])
				.on('result', function(data){
					isBanned = data.banned == 1 ? true : false;
				})
				.on('end', function(){
					notifyOnJoinPublic(msg, users[client.id]);
				});
		}
    });
	
	client.on("removeAdmin", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var userID = users[client.id];
			var isAdmin = false;
	
			db.query('SELECT ID FROM ' + wp_prefix + "simplychat_group_admins WHERE chat_id = ? && user_id = ?", [msg.room, userID])
			.on('result', function(data){
                isAdmin = true;
            })
            .on('end', function(){
				if(isAdmin) {
					var cid = clientID(msg.uid);

					db.query("DELETE FROM "+wp_prefix+"simplychat_group_admins WHERE chat_id = ? && user_id = ?", [msg.room, msg.uid])

					if(cid != false && socket.sockets.connected[cid] != undefined) {
						var result = {
							cid: msg.room,
						};

						var json_result = JSON.stringify(result);
						socket.sockets.connected[cid].emit('removedAdmin', json_result);
					}
				}
            });
		}
    });
	
	client.on("setAdmin", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var userID = users[client.id];
			var isAdmin = false;
	
			db.query('SELECT ID FROM ' + wp_prefix + "simplychat_group_admins WHERE chat_id = ? && user_id = ?", [msg.room, userID])
			.on('result', function(data){
                isAdmin = true;
            })
            .on('end', function(){
				if(isAdmin) {
					var cid = clientID(msg.uid);

					db.query("INSERT INTO "+wp_prefix+"simplychat_group_admins(chat_id, user_id) VALUES (?, ?)", [msg.room, msg.uid])

					if(cid != false && socket.sockets.connected[cid] != undefined) {
						var result = {
							cid: msg.room,
						};

						var json_result = JSON.stringify(result);
						socket.sockets.connected[cid].emit('setAdmin', json_result);
					}
				}
            });
		}
    });
	
	client.on("changeGroupDetails", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var userID = users[client.id];
			var isAdmin = false;
	
			db.query('SELECT ID FROM ' + wp_prefix + "simplychat_group_admins WHERE chat_id = ? && user_id = ?", [msg.room, userID])
			.on('result', function(data){
                isAdmin = true;
            })
            .on('end', function(){
				if(isAdmin) {
					if(msg.titleChanged) {
						var time = moment().unix();
						db.query("INSERT INTO "+wp_prefix+"simplychat_chat_messages(chat_room, message, time, type) VALUES (?, ?, ?, 'changed_name')", [msg.room, msg.title, time]);
					}
					var usrs = [];
					db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ?", [msg.room])
						.on("result", function(data) {
							if(data.user_id != userID)
								usrs.push(data.user_id);
						})
						.on("end", function() {
							for(var i = 0; i<usrs.length; i++) {
								var uid = usrs[i];
								var cid = clientID(uid);
								if(cid != false && socket.sockets.connected[cid] != undefined) {
									var result = {
										title: msg.title,
										room: msg.room,
										chat_img: msg.chat_img,
										isChanged: msg.titleChanged
									};

									var json_result = JSON.stringify(result);
									socket.sockets.connected[cid].emit('changeGroupDetails', json_result);
								}
							}
						});
				}
            });
		}
    });
	
	client.on("changeGroupDetailsAdmin", function(data){
		if(users[client.id] > 0) {
			var msg = JSON.parse(data);
			var userID = users[client.id];
			
			var usrs = [];
			db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ?", [msg.room])
				.on("result", function(data) {
					usrs.push(data.user_id);
				})
				.on("end", function() {
					for(var i = 0; i<usrs.length; i++) {
						var uid = usrs[i];
						var cid = clientID(uid);
						if(cid != false && socket.sockets.connected[cid] != undefined) {
							var result = {
								title: msg.title,
								room: msg.room,
								chat_img: msg.chat_img,
								isChanged: msg.titleChanged
							};

							var json_result = JSON.stringify(result);
							socket.sockets.connected[cid].emit('changeGroupDetails', json_result);
						}
					}
				});
		}
    });
});

function findCidByFriends(friends, users) {
	var result = [];
	
	for(var i = 0; i<friends.length; i++) {
		var fid = friends[i];
		Object.keys(users).map(function(cid) {
			if(users[cid] == fid) {
				result.push(cid);
			}
		});
	};
	
	return result;
}

function clientID(uid) {
	var result = [];
	Object.keys(users).map(function(cid) {
		if(users[cid] == uid) {
			result.push(cid);
		}
	});
	if(result.length > 0)
		return result;
	return false;
}

function updateOnlineFriends(uid, type, id, i) {
	if(socket.sockets.connected[i] != undefined)
		socket.sockets.connected[i].emit(type, id);
}

function sendTextMsg(msg, uid, time, client_id) {
	var hash = msg.hash;
	var uname = msg.uname;
	var uphoto = msg.userPhoto;
	var message = ban_word(msg.message);
	var type = msg.type;
	var cname = msg.cname;
	var msg_i = msg.msg_i;
	var isOnline = msg.isOnline;
	var url = msg.profile;
	if(type == "group") {
		var photo = msg.photo;
	} else {
		var photo = null;
	}
	
	db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ? && user_id != ? && status = 1", [hash, uid], function(err, rows) {
		if(err) {
			logger.error(err);
		} else {
			rows.forEach((row) => {
				var cid = clientID(row.user_id);
				if(cid != false) {
					cid.map(function(i) {
						if(socket.sockets.connected[i] != undefined) {
							var result = {
								message: message,
								username: uname,
								cname: cname,
								photo: photo,
								userPhoto: uphoto,
								cid: hash,
								uid: row.user_id,
								isOnline: isOnline,
								type: type,
								time: time,
								url: url
							};
									
							var json_result = JSON.stringify(result);
							socket.sockets.connected[i].emit('textMessage', json_result);
						}
					});
				}
			});
			if(socket.sockets.connected[client_id] != undefined)
				socket.sockets.connected[client_id].emit('updateSentMessage', msg_i, false, message, hash);
		}
	});
}

function sendFileMsg(msg, uid, time, client_id) {
	var hash = msg.hash;
	var uname = msg.uname;
	var uphoto = msg.userPhoto;
	var type = msg.type;
	var cname = msg.cname;
	var msg_i = msg.msg_i;
	var isOnline = msg.isOnline;
	var url = msg.profile;
	var fileURL = msg.fileURL;
	var fileName = msg.fileName;
	var fileType = msg.fileType;
	var fileMime = (fileType == "user_media_vid" || fileType == "user_media_music" ? msg.fileMime : null)
	if(type == "group") {
		var photo = msg.photo;
	} else {
		var photo = null;
	}
	var lastMessage;
	
	switch(fileType) {
		case "user_media_img":
			lastMessage = '<i class="fa fa-picture-o" aria-hidden="true"></i> Picture';
			break;
		case "user_media_video":
			lastMessage = '<i class="fa fa-ideo-camera" aria-hidden="true"></i> Video';
			break;
		case "user_media_file":
			lastMessage = '<i class="fa fa-file" aria-hidden="true"></i> File';
			break;
		case "user_media_music":
			lastMessage = '<i class="fa fa-headphones" aria-hidden="true"></i> Music';
			break;
	}
	
	db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ? && user_id != ? && status = 1", [hash, uid], function(err, rows) {
		if(err) {
			logger.error(err);
		} else {
			rows.forEach((row) => {
				var cid = clientID(row.user_id);
				if(cid != false) {
					cid.map(function(i) {
						if(socket.sockets.connected[i] != undefined) {
							var result = {
								username: uname,
								cname: cname,
								photo: photo,
								userPhoto: uphoto,
								cid: hash,
								uid: row.user_id,
								isOnline: isOnline,
								type: type,
								time: time,
								url: url,
								fileURL: fileURL,
								fileName: fileName,
								fileType: fileType,
								fileMime: fileMime,
							};

							var json_result = JSON.stringify(result);
							socket.sockets.connected[i].emit('fileMessage', json_result);
						}
					});
				}
			});
			if(socket.sockets.connected[client_id] != undefined)
				socket.sockets.connected[client_id].emit('updateSentMessage', msg_i, true, lastMessage, hash);
		}
	});
}

function notifyOnJoin(msg, client_id) {
	var usrs = [];

	db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ?", [msg.room])
		.on("result", function(data) {
			usrs.push(data.user_id);
		})
		.on("end", function() {
			if(usrs.indexOf(parseInt(msg.uid)) > -1) {
				usrs.splice(usrs.indexOf(msg.uid), 1);
			}

			for(var i = 0; i<usrs.length; i++) {
				var uid = usrs[i];
				var cid = clientID(uid);
				if(cid != false && socket.sockets.connected[cid] != undefined) {
					var result = {
						cname: msg.title,
						uname: msg.uname,
						uid: msg.uid,
						photo: msg.chat_img,
						cid: msg.room,
						url: msg.url,
						isOnline: msg.isOnline,
						adminID: users[client_id],
						members: msg.members,
						isPublic: msg.isPublic
					};

					var json_result = JSON.stringify(result);
					socket.sockets.connected[cid].emit('joinGroupOther', json_result);
				}
			}
		});
}

function notifyOnKick(msg, client_id) {
	var usrs = [];

	db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ?", [msg.room])
		.on("result", function(data) {
			usrs.push(data.user_id);
		})
		.on("end", function() {
			for(var i = 0; i<usrs.length; i++) {
				var uid = usrs[i];
				var cid = clientID(uid);
				if(cid != false && socket.sockets.connected[cid] != undefined) {
					var result = {
						cname: msg.title,
						uname: msg.uname,
						uid: msg.uid,
						photo: msg.chat_img,
						cid: msg.room,
						adminID: users[client_id],
						members: msg.members
					};

					var json_result = JSON.stringify(result);
					socket.sockets.connected[cid].emit('kickGroupOther', json_result);
				}
			}
		});
}

function notifyOnLeave(msg) {
	var usrs = [];

	db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ?", [msg.room])
		.on("result", function(data) {
			usrs.push(data.user_id);
		})
		.on("end", function() {
			for(var i = 0; i<usrs.length; i++) {
				var uid = usrs[i];
				var cid = clientID(uid);
				if(cid != false && socket.sockets.connected[cid] != undefined) {
					var result = {
						cname: msg.title,
						uname: msg.uname,
						photo: msg.chat_img,
						cid: msg.room,
						members: usrs.length
					};

					var json_result = JSON.stringify(result);
					socket.sockets.connected[cid].emit('leaveChatOther', json_result);
				}
			}
		});
}

function notifyOnJoinPublic(msg, uid) {
	var usrs = [];

	db.query("SELECT user_id FROM " + wp_prefix + "simplychat_chat_members WHERE chat_room = ?", [msg.room])
		.on("result", function(data) {
			if(uid != data.user_id)
				usrs.push(data.user_id);
		})
		.on("end", function() {
			for(var i = 0; i<usrs.length; i++) {
				var uid = usrs[i];
				var cid = clientID(uid);
				if(cid != false && socket.sockets.connected[cid] != undefined) {
					var result = {
						cname: msg.title,
						uname: msg.uname,
						photo: msg.chat_img,
						cid: msg.room,
						members: usrs.length + 1
					};

					var json_result = JSON.stringify(result);
					socket.sockets.connected[cid].emit('joinPublicGroupOther', json_result);
				}
			}
		});
}

function preg_quote(str, delimiter) {
  return (str + '')
    .replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]', 'g'), '\\$&')
}

function ban_word(word) {
	if(ban_words_list.length > 0) {
		var re = new RegExp('(?![^<]*>)\\b('+ban_words_list.map(Function.prototype.call, String.prototype.toLowerCase).map(preg_quote).join('|')+')\\b', "ig");
		return word.replace(re, function(match, text) {
			var index = ban_words_list.indexOf(text.toLowerCase());
			if(index >= 0) {
				return ban_words[index].replace(/\\/g, '');
			} else {
				return "@#!?";
			}
				
		});
	} else {
		return word;
	}
}

String.prototype.toHHMMSS = function () {
    var sec_num = parseInt(this, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    var time    = hours+':'+minutes+':'+seconds;
    return time;
}