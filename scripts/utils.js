var DEFAULT_CHANNEL = "C2RF9N334";
var PLAYER_ROLES = {wolf: "wolf", healer: "healer", seeker: "seeker", villager: "villager"};
var roles = ['wolf', 'healer', 'seeker', 'villager'];

var utils = {
    getCommandList: function () {
      return {
        join: "`join village_name`",
        newGame: "`new game village_name`",
      }
    },
    getAvailableGame: function (robot, villages) {
      if(robot.brain.data.games == null) {
            return false;
      }

      for (var i in villages) {
        var village = villages[i];
        if(this.gameExists(robot, village.id))
          return village
      }
      
      return false;
    },
    gameExists: function (robot, gameId) {
      if(robot.brain.data.games == null) {
            return false;
      }

      if(!robot.brain.data.games[gameId])
        return false;

      return robot.brain.data.games[gameId].gameOn;
    },
    newGame: function (robot, village, res) {
      if(robot.brain.data.games == null) {
          robot.brain.data.games = {};
      }

      if(this.gameExists(robot, village.id)){
        if(robot.brain.data.games[village.id].gameOn){
          if(!robot.brain.data.games[village.id].locked){
            res.send("This village is still very strong, you can join with the following command " + this.getCommandList()['join']);
          }else{
            res.send("This village is still very strong, Unfortunately the gate is locked");
          }
          return false;
        }
      }else{
        if(village.owner_id !== res.message.user.id){
          res.send("You are not the owner of this village, contact " + village.owner);
          return false;
        }
      }

      robot.brain.data.games[village.id] = {
        players: {},
        playerIds: [],
        gameOn: true,
        registration: true,
        locked: false, 
        total: 0, count:{
          wolf: 0,
          villager: 0,
          seeker: 0,
          healer: 0
        }};
      return true;
    },
    addPlayer: function(robot, village, res){
      var player = {
        name: res.message.user.name,
        id: res.message.user.id,
        alive: true,
      };
      if(robot.brain.data.games[village.id].players[player.id] !== undefined){
        if(robot.brain.data.games[village.id].players[player.id].alive){
          res.send("You're already a member of " + village.name + " village");
          return;
        }else{
          res.send(village.name + " is not a land of the dead :mooning:");
          return;
        }
      }else{
        //player['role'] = this.getRole(village);
        robot.brain.data.games[village.id].players[player.id] = player;
        robot.brain.data.games[village.id].playerIds.push(player.id);
        robot.brain.data.games[village.id].total += 1;
        res.send("Welcome to " + village.name + " village, your safty is in your hands :shrug:. I'm waiting for other players to join so I can assign your role!");
      }
    },
    addPlayerWithRole: function(robot, village, res){
      var player = {
        name: res.message.user.name,
        id: res.message.user.id,
        alive: true,
      };
      if(robot.brain.data.games[village.id].players[player.id] !== undefined){
        if(robot.brain.data.games[village.id].players[player.id].alive){
          res.send("You're already a member of " + village.name + " village");
          return;
        }else{
          res.send(village.name + " is not a land of the dead :mooning:");
          return;
        }
      }else{
        player['role'] = this.getRole(village);
        robot.brain.data.games[village.id].players[player.id] = player;
        robot.brain.data.games[village.id].total += 1;
        robot.brain.data.games[village.id].count[player['role']] += 1;
        res.send("Welcome to " + village.name + " village, your safty is in your hands :shrug:. Your role is " + player['role']);
      }
    },
    getRole: function(village) {
      var game = robot.brain.data.games[village.id];
      return PLAYER_ROLES.villager;
      //if(game.count.total < )
    },
    endGame: function(robot, village, res, force){
      if(village.owner_id !== res.message.user.id){
          res.send("You are not permitted to end this game. Contact " + village.owner);
          return;
      }

      if(force){
        robot.messageRoom(DEFAULT_CHANNEL, "@here " + village.owner + " has terminated the ongoing game in " + village.name + " village :sad-fb:");
      }else{
        this.showGameResult(robot, village);
      }

      robot.brain.data.games[village.id].gameOn = false;
      robot.brain.data.games[village.id].players = {};
    },
    showGameResult: function(robot, village){
      robot.messageRoom(DEFAULT_CHANNEL, "@here The nightmail in " + village.name + " village has ended, the wolves have been totally eliminated by the bravery of all the villagers.");
    },
    villageGate: function(robot, villages, village, status, res){
      if(villages[village.id] === undefined){
          res.send(village.name + " is not on the map :shrug:");
          return;
      }

      if(villages[village.id].owner_id !== village.owner_id){
          res.send("You are not permitted to lock the gate. Contact " + villages[village.id].owner);
          return;
      }
      robot.brain.data.games[village.id].locked = status;
      if(status){
        res.send("Entrance gate to " + villages[village.id].name + " has been locked");
      }else{
        res.send("Entrance gate to " + villages[village.id].name + " has been opened");
      }
      
    }
};

module.exports = utils;