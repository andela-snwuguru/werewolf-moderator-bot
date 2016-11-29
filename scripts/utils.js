var DEFAULT_CHANNEL = "C2RF9N334";

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

      robot.brain.data.games[village.id] = {players: {}, gameOn: true, locked: false};
      return true;
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