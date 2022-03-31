const { App } = require('@slack/bolt')
const bot = require('./bot.js')
const { parse } = require('./commands.js')

const app = new App({
  socketMode: true,
  token:      process.env.BOT_TOKEN,
  appToken:   process.env.APP_TOKEN,
});

const dispatch = async (msg, say) => {
  msg = msg.replace(/\s*<@.*?>\s*/g, '')
  console.log(`in: "${msg}"`)
  bot.go(parse(msg), say)
}

app.message('', async ({ message, say }) => {
  await dispatch(message.text, say)
});

app.event('app_mention', async ({ event, say }) => {
  await dispatch(event.text, say)
});

(async () => {
  bot.init()
  await app.start()
  console.log('LKEBot started - shall we deploy a k8s?')
})()
