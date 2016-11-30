//set env
var dotenv = require('node-env-file');
var env = process.env.NODE_ENV || 'development';

if (env !== "production") {
    dotenv('.env');
}

var _         = require('lodash');
var async     = require('async');
var Hashids   = require('hashids');
var mock_data = require('./stubs.js');
var moment    = require('moment');
var NRP       = require('node-redis-pubsub');
var request   = require('request');
var utils   = require('./utils.js');


// set globals
var CHANNEL_ID;
var PLAYER_ROLES = {wolf: "wolf", healer: "healer", seeker: "seeker", villager: "villager"};
var PLAYER_HEALTH = {alive: "alive", dead: "dead"};
var DEFAULT_CHANNEL = "C2RF9N334";
var DEFAULT_TIMEOUT = 60000;
var ACTIVITY_TIMEOUT = 20000;
var DEFAULT_GAMEID = "WOLFEY";
var villages = {};


//bot listeners
function bot(robot) {

    robot.respond(/delete brain/i, function (res) {
        robot.brain.data.games = {};
        res.send("brain deleted");
    });

    robot.respond(/join (.*)/i, function (res) {
        var village = {
            name: res.match[1], 
            id:res.match[1].replace(" ", "_"), 
        };
        if(utils.gameExists(robot, village.id)){
            if(robot.brain.data.games[village.id].registration){
                utils.addPlayer(robot, village, res);
                console.log("joined: ", res.message.user.name);
            }else{
                if(robot.brain.data.games[village.id].locked){
                    res.send("You are late to the party, ask " + village.owner + " to open the gate for you.");
                    return;
                }
                utils.addPlayerWithRole(robot, village, res);
            }
            
        }else{
            res.send("No existing village called " + village.name + ", you can create your own village with the following command "+ utils.getCommandList()['newGame']);
        }
        
    });

    robot.respond(/new game (.*)/i, function (res) {
        var village = {
            name: res.match[1], 
            id:res.match[1].replace(" ", "_"), 
            owner_id: res.message.user.id,
            owner: res.message.user.name
        };

        if(villages[village.id] === undefined){
            villages[village.id] = village;
        }else{
            village = villages[village.id];
        }

        if(utils.newGame(robot, village, res)){
            res.send(village.name + " has been created");
            robot.emit("broadcast join", village);
        }
    });

    robot.respond(/lock gate (.*)/i, function (res) {
        var village = {
            name: res.match[1], 
            id:res.match[1].replace(" ", "_"), 
            owner_id: res.message.user.id,
            owner: res.message.user.name
        };
        utils.villageGate(robot, villages, village, true, res);
    });

    robot.respond(/open gate (.*)/i, function (res) {
        var village = {
            name: res.match[1], 
            id:res.match[1].replace(" ", "_"), 
            owner_id: res.message.user.id,
            owner: res.message.user.name
        };
        utils.villageGate(robot, villages, village, false, res);
    });

    robot.respond(/end game (.*)/i, function (res) {
        var village = {
            name: res.match[1], 
            id:res.match[1].replace(" ", "_"), 
            owner_id: res.message.user.id,
            owner: res.message.user.name
        };

        if(villages[village.id] === undefined){
            res.send(village.name + " is not on the map :shrug:");
            return;
        }else{
            village = villages[village.id];
        }

        utils.endGame(robot, village, res, true);
    });


    robot.on("broadcast join", function(village) {
        robot.messageRoom(
            DEFAULT_CHANNEL, 
            "@here New wolf game starting! in " + village.name + " village To join, DM me with the command: " 
            + utils.getCommandList()['join'] + " In " + (DEFAULT_TIMEOUT/(1000 * 60)) + 
            " minutes, registration will be over!"
        );
        var gameId = village.id;
        robot.brain.data.games[gameId].currentHealedPlayer = "";
        robot.brain.data.games[gameId].WOLVES_DM = "";
        robot.brain.data.games[gameId].HEALER_DM = "";
        robot.brain.data.games[gameId].SEEKER_DM = "";
        robot.brain.data.games[gameId].wolfIds = [];

        setTimeout(function() {
            //TODO block users from joining a game in session
            //TODO unique users
            console.log("time out to join");
            robot.messageRoom(DEFAULT_CHANNEL, "@here Registration is now over! Sending you all DMs with your new roles ;)");
            console.log("players", robot.brain.data.games[gameId].players);
            robot.brain.data.games[gameId].registration = false;
            robot.brain.data.games[gameId].locked = true;
            robot.emit("assign roles", village);
            return true;
        }, DEFAULT_TIMEOUT);
    });

    robot.on("assign roles", function(village) {
        console.log("assigning roles");
        //send DMs, inform channel of number of players, wolves, healers. etc
        var gameId = village.id;
        generateRoleIndexesAndAssign(robot, village.id);
        var wolfIds = robot.brain.data.games[gameId].wolfIds;
        if(wolfIds.length > 1){
            createMultiParty(wolfIds, function(multiDM) {
                console.log("WOLVES DM IS", multiDM);
                robot.brain.data.games[gameId].WOLVES_DM = multiDM;
                robot.emit("village sleep", village);
            });
        }
        else {
            var wolfId = robot.brain.data.games[gameId].playerIds[wolfIds[0]];
            robot.brain.data.games[gameId].WOLVES_DM = wolfId;
            //robot.emit("village sleep");
        }
        console.log("players", robot.brain.data.games[gameId].players);
    });

    robot.on("village sleep", function(village) {
        //the village goes to sleep
        robot.messageRoom(DEFAULT_CHANNEL, "It's midnight :crescent_moon: The villagers go to sleep :sleepy: :sleeping:");
        robot.emit("wolves wake up", village);
    });

    robot.on("wolves wake up", function(village) {
        //the wolves wake up and select someone to kill
        robot.messageRoom(DEFAULT_CHANNEL, "The wolves come out. They acknowledge themselves :wolf-thumbs-up: They seek who to kill");
        var gameId = village.id;
        var wolvesDMChannel = robot.brain.data.games[gameId].WOLVES_DM;
        console.log("wolves wake up", wolvesDMChannel);
        robot.messageRoom(wolvesDMChannel, "Meal Time! Discuss amongst yourselves and one of you can issue the final kill command: `kill <username>` You have 20 seconds");
        
        robot.hear(/kill (.*)/i, function (res) {
            var killedPlayer = res.match[1].replace("@", "");
            robot.brain.data.games[gameId].currentKilledPlayer = killedPlayer;
            res.send("You have decided to kill " + killedPlayer + ". :wolf-thumbs-up:");    
        });

        setTimeout(function() {
            //trigger healer event
            robot.messageRoom(DEFAULT_CHANNEL, "The wolves have decided on who to kill");
            console.log("wolves decided to kill ", robot.brain.data.games[gameId].currentKilledPlayer);
            robot.emit("healer", village);
            return true;
        }, ACTIVITY_TIMEOUT);


    });

    robot.on("healer", function (village) {
        //the healer wakes up to heal a player from speculated wolf attacks
        console.log("healer wakes up");
        robot.messageRoom(DEFAULT_CHANNEL, "It's 2am in the morning. The healer wakes up and feels led to heal someone");
        var gameId = village.id;
        var healerDMChannel = robot.brain.data.games[gameId].HEALER_DM;
        robot.messageRoom(healerDMChannel, "Heal a fellow villager with the command: `heal <username>` You have 20 seconds");

        robot.respond(/heal (.*)/i, function (res) {
            if(robot.brain.data.games[gameId].currentHealedPlayer){
                res.send("Unfortunately you have used up you healing :pill:");
                return false;
            }
            var healedPlayer = res.match[1].replace("@", "");
            robot.brain.data.games[gameId].currentHealedPlayer = healedPlayer;
            res.send("You have healed " + healedPlayer + ". :pill:");
        });

        setTimeout(function() {
            //trigger seeker event
            robot.messageRoom(DEFAULT_CHANNEL, "The healer has healed someone :pill:");
            console.log("healer decided to heal ", robot.brain.data.games[gameId].currentHealedPlayer);
            robot.emit("seeker", village);
            return true;
        }, ACTIVITY_TIMEOUT);
    });


    robot.on("seeker", function (village) {
        //the seeker wakes up to consult the oracle
        console.log("seeker wakes up");
        var suspect = "";
        robot.messageRoom(DEFAULT_CHANNEL, "It's 3am in the morning. The seeker wakes up to consult the oracle");
        var gameId = village.id;
        var seekerDMChannel = robot.brain.data.games[gameId].SEEKER_DM;
        robot.messageRoom(seekerDMChannel, "Chosen one, ask the Oracle to reveal who the wolf is with the command: `seek <suspect_username>` You have 20 seconds");
        
        robot.respond(/seek (.*)/i, function (res) {
            console.log("suspect received");
            if(robot.brain.data.games[gameId].seeked){
                res.send("The oracle cannot answer you at this time");
                return;
            }
            suspect = res.match[1].replace("@", "");
            var suspectObj = _.find(robot.brain.data.games[gameId].players, {name: suspect});
            var isWolf = suspectObj.role === PLAYER_ROLES.wolf;

            if(isWolf) {
                res.send("Yes, " + suspect + " is a wolf!");
            }
            else {
                res.send("No, " + suspect + " is not a wolf!");
            }
            robot.brain.data.games[gameId].seeked = true;
        });
        setTimeout(function() {
            //trigger awake event
            robot.messageRoom(DEFAULT_CHANNEL, "The seeker goes back to sleep");
            console.log("seeker asked for", suspect);
            robot.emit("process choice", village);
            return true;
        }, 20000);
    });

    robot.on("process choice", function (village) {
        var gameId = village.id;
        var killedPlayer = robot.brain.data.games[gameId].currentKilledPlayer;
        var healedPlayer = robot.brain.data.games[gameId].currentHealedPlayer;

        if(killedPlayer != healedPlayer) {
            killPlayer(killedPlayer);
            robot.brain.data.games[gameId].currentKilledPlayer = null;
            robot.brain.data.games[gameId].currentHealedPlayer = null;
            robot.emit("awake with deaths", killedPlayer);
        }
        else {
            robot.emit("awake no deaths");
        }

    });

    robot.on("awake no deaths", function() {
        //the village wakes up
        robot.messageRoom(DEFAULT_CHANNEL, "It's morning! :sun_small_cloud:  The village wakes up! :rooster:, It was the most peaceful night ever");
        //robot.messageRoom(DEFAULT_CHANNEL, "Nobody died last night!");
        //trigger banter
        robot.emit("banter");
    });

    robot.on("awake with deaths", function(killedPlayer) {
        //the village wakes up
        robot.messageRoom(DEFAULT_CHANNEL, "It's morning! :sun_small_cloud:  The village wakes up! :rooster:");
        robot.messageRoom(DEFAULT_CHANNEL, "Sadly, @" + killedPlayer + " died last night! :skull:");
        //trigger banter
        robot.emit("banter");
    });
    
    robot.on("banter", function() {
        //3 mins: players converse in channel to accuse and defend themselves
        robot.messageRoom(DEFAULT_CHANNEL, "There are still wolves in the village! Discuss amongst each other to find out who the wolf is. In 2 mins, you'll have the chance to vote who you think the wolf is for execution");
        setTimeout(function() {
            //trigger awake event
            // robot.emit("voting");
            return true;
        }, 20000);

    }); 

    robot.on("voting", function() {
        //players nominate a player that they think is a wolf
        robot.messageRoom(DEFAULT_CHANNEL, "It's vigilante justice time! Send me a DM with the command: `vote <suspect_username>` to nominate a suspect");
        var gameId = DEFAULT_GAMEID;
        robot.brain.data.games[gameId].currentRoundVotes = [];
        robot.respond(/vote (.*)/i, function (res) {
            var player = res.match[1];
            robot.brain.data.games[gameId].currentRoundVotes.push(player);
        });
        setTimeout(function() {
            robot.messageRoom(DEFAULT_CHANNEL, "Voting is over!");
            
            robot.emit("execution");
            return true;
        }, 20000);

    });

    robot.on("execution", function() {
        //notifies channel of who the vote executed, triggers loop
        //calculate player with most votes and kill them
        var gameId = DEFAULT_GAMEID;
        var playerWithMostVotes = getPlayerWithMostVotes(robot.brain.data.games[gameId].currentRoundVotes);
        killPlayerByVotes(robot, playerWithMostVotes);

        robot.messageRoom(DEFAULT_CHANNEL, "By popular demand, @" + playerWithMostVotes + " has been executed! :knife: :cry:");
        robot.emit("new round");
    });

    robot.on("new round", function() {
        //Calculate number of wolves vs villagers still in the game. Determine whether to end game or continue
        var gameId = DEFAULT_GAMEID;
        var numWolves = countWolves(robot);
        var numVillagers = countVillagers(robot, numWolves);

        if(numVillagers < numWolves) {
            //wolves win
            robot.messageRoom(DEFAULT_CHANNEL, "GAME OVER! The wolves win! :wolf-thumbs-up:");
            robot.brain.data.games[gameId].status = "off";
        }
        else if(numWolves === 0) {
            robot.messageRoom(DEFAULT_CHANNEL, "GAME OVER! All the wolves are dead so the villagers win! :raised_hands:");
            robot.brain.data.games[gameId].status = "off";
        }
        else {
            robot.emit("village sleep");
        }
        
    });
}

function textifyActivePlayers(players) {
    var activePlayers = _.filter(players, {health: PLAYER_HEALTH.alive});
    var activePlayerNames = _.map(activePlayers, 'name');
    return _.join(activePlayerNames, "\n");
}

function countWolves(robot) {
    var gameId = DEFAULT_GAMEID;
    var wolves = _.filter(robot.brain.data.games[gameId].players, {role: PLAYER_ROLES.wolf, health: PLAYER_HEALTH.alive});
    return wolves.length;
}

function countVillagers(robot) {
    var gameId = DEFAULT_GAMEID;
    var aliveVillagers = _.filter(robot.brain.data.games[gameId].players, {role: PLAYER_ROLES.villager, health: PLAYER_HEALTH.alive});
    var aliveHealer = _.filter(robot.brain.data.games[gameId].players, {role: PLAYER_ROLES.healer, health: PLAYER_HEALTH.alive});
    var aliveSeeker = _.filter(robot.brain.data.games[gameId].players, {role: PLAYER_ROLES.seeker, health: PLAYER_HEALTH.alive});
    var numVillagers = aliveVillagers.length + aliveHealer.length + aliveSeeker.length;

    return numVillagers - numWolves;
}

function killPlayer(robot, playerName) {
    var gameId = DEFAULT_GAMEID;
    var player = _.find(robot.brain.data.games[gameId].players, {name: playerName});
    player.health = PLAYER_HEALTH.dead;
}

function sendPlayerDeadNotice(robot, playerName) {
    var deathMessage = "@" + player + " is dead! :skull:";
    robot.messageRoom(DEFAULT_CHANNEL, "@" + player + "");
}

function killPlayerByVotes(robot, playerName) {
    //TODO: consider case where votes yielded no clear winner
    killPlayer(robot, playerName);
    sendPlayerDeadNotice(robot, playerName);
}

function getPlayerWithMostVotes(votes) {
    return _.chain(votes).countBy().pairs().max(_.last).head().value();
}

function generateWolfIndexes(numWolves, numPlayers) {
    wolfIndexes = [];

    for(var i = 0; i < numWolves; i++) {
        var index = Math.round(Math.random() * (numPlayers - 1));

        while(wolfIndexes.indexOf(index) > -1) {
            index  = Math.round(Math.random() * (numPlayers - 1));
        }

        wolfIndexes.push(index);
    }

    return wolfIndexes;
}

function generateHealerIndex(wolfIndexes, numPlayers) {
    var healerIndex  = Math.round(Math.random() * (numPlayers - 1));

    while(wolfIndexes.indexOf(healerIndex) > -1) {
        healerIndex  = Math.round(Math.random() * (numPlayers - 1));
    }

    return healerIndex;
}

function generateSeekerIndex(wolfIndexes, healerIndex, numPlayers) {
    var seekerIndex  = Math.round(Math.random() * (numPlayers - 1));

    while(wolfIndexes.indexOf(seekerIndex) > -1 || seekerIndex === healerIndex) {
        seekerIndex  = Math.round(Math.random() * (numPlayers - 1));
    }

    return seekerIndex;
}

function notifyPlayerOfRole(robot, slackId, role) {
    //TODO edit message based
    var message = "Thanks for joining the game! In this game, you're a ";
    switch(role) {
        case PLAYER_ROLES.wolf:
            message += "wolf! :wolf-thumbs-up:"
            break;
        case PLAYER_ROLES.healer:
            message += "healer! :pill:"
            break;
        case PLAYER_ROLES.seeker:
            message += "seeker! :wizard:"
            break;
        default:
            message += "villager ¯\\_(ツ)_/¯"
    }
    robot.messageRoom(slackId, message);
}

//refactor to modify player roles in place
function assignRolesAndNotifyPlayers(robot, gameId, wolfIndexes, healerIndex, seekerIndex) {
    var players = robot.brain.data.games[gameId].playerIds;
    console.log("assignRolesAndNotifyPlayers", players);

    for(var playerIndex in players) {
        var intPlayerIndex = Number(playerIndex); // because for in keys are strings
        robot.brain.data.games[gameId].players[players[intPlayerIndex]].role = PLAYER_ROLES.villager;
        
        if(wolfIndexes.indexOf(intPlayerIndex) > -1) {
            robot.brain.data.games[gameId].players[players[intPlayerIndex]].role = PLAYER_ROLES.wolf;
            notifyPlayerOfRole(robot, players[intPlayerIndex], PLAYER_ROLES.wolf);
        }
        else if(intPlayerIndex === healerIndex) {
            robot.brain.data.games[gameId].players[players[intPlayerIndex]].role = PLAYER_ROLES.healer;
            notifyPlayerOfRole(robot, players[intPlayerIndex], PLAYER_ROLES.healer);
        }
        else if(intPlayerIndex === seekerIndex) {
            robot.brain.data.games[gameId].players[players[intPlayerIndex]].role = PLAYER_ROLES.seeker;
            notifyPlayerOfRole(robot, players[intPlayerIndex], PLAYER_ROLES.seeker);
        }
        else {
            notifyPlayerOfRole(robot, players[intPlayerIndex], PLAYER_ROLES.villager);
        }
    }
}

function generateRoleIndexesAndAssign(robot, gameId) {
    var players = robot.brain.data.games[gameId].playerIds;
    var numPlayers = players.length;
    var numWolves = Math.floor(0.3 * numPlayers);

    var wolfIndexes = generateWolfIndexes(numWolves, numPlayers);
    var healerIndex = generateHealerIndex(wolfIndexes, numPlayers);
    var seekerIndex = generateSeekerIndex(wolfIndexes, healerIndex, numPlayers);

    assignRolesAndNotifyPlayers(robot, gameId, wolfIndexes, healerIndex, seekerIndex);
    robot.brain.data.games[gameId].wolfIndexes = wolfIndexes;
    robot.brain.data.games[gameId].healerIndex = healerIndex;
    robot.brain.data.games[gameId].seekerIndex = seekerIndex;
    robot.brain.data.games[gameId].HEALER_DM = players[healerIndex];
    robot.brain.data.games[gameId].SEEKER_DM = players[seekerIndex];
    robot.brain.data.games[gameId].wolfIds = getWolfIds(robot, players, wolfIndexes);
}

function createMultiParty(slackIds, cb) {
    params = {
        url: "https://slack.com/api/mpim.open",
        headers: {
            'Content-Type': 'application/json'
        },
        qs: {
            users: slackIds.join(","),
            token: process.env.HUBOT_SLACK_TOKEN
        }
    }
    request.get(params, function (err, status, body){
        console.log(err, body);
        console.log("Multi Party Channel");
        body = JSON.parse(body);
        console.log(body.group.id);
        cb(body.group.id);
    })
}

function getWolfIds(robot, players, wolfIndexes) {
    var ids = [];
    for (var i in wolfIndexes) {
        console.log("setting up wolves DM", wolfIndexes, wolfIndexes[i], players, players[wolfIndexes[i]], players[wolfIndexes[i]].id);
        ids.push(players[wolfIndexes[i]]);
    }
    return ids;
}

function setUpWolvesDM(robot, gameId, ids) {
    createMultiParty(ids, function(multiDM) {
        console.log("WOLVES DM IS", multiDM);
        robot.brain.data.games[gameId].WOLVES_DM = multiDM;
    });
}


module.exports = bot;