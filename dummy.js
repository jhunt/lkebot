const bot = require('./bot.js')
const { parse } = require('./commands.js')

module.exports = s => bot.go(parse(s), console.log)
