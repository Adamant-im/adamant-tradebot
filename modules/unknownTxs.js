'use strict';

/**
 * @module modules/unknownTxs
 * @typedef {import('types/bot/unknownTxs.d.js').HandleUnknownTx} HandleUnknownTx
 * @typedef {import('types/bot/unknownTxs.d.js').UnknownTxReplyCollectionIndex} UnknownTxReplyCollectionIndex
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').IncomingAdmTxDbRecord} IncomingAdmTxDbRecord
 */

const utils = require('../helpers/utils');
const db = require('./DB');
const config = require('./configReader');
const constants = require('../helpers/const');
const log = require('../helpers/log');
const adamantApi = require('./adamantApi');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

/** How far back to look for prior `unknown` messages from the same sender. */
const UNKNOWN_TX_LOOKBACK_MS = constants.DAY;

/** Gap after the previous unknown message that starts a new reply "session". */
const UNKNOWN_TX_SESSION_GAP_MS = 2 * 3600 * 1000;

log.log(`Module ${moduleName} is loaded.`);

/**
 * Handles a chat message that is not a recognized command or bare transfer.
 *
 * Reply tone escalates with the number of recent `unknown` messages from the same
 * sender (within {@link UNKNOWN_TX_LOOKBACK_MS}). If the sender was quiet for
 * {@link UNKNOWN_TX_SESSION_GAP_MS}, the counter resets to the welcome message.
 *
 * @param {AdamantIncomingTx} tx Incoming ADM transaction from the blockchain API
 * @param {IncomingAdmTxDbRecord} itx `incomingtxs` ORM record for this transaction
 * @returns {Promise<void>}
 */
async function handleUnknownTx(tx, itx) {
  try {
    if (itx.isProcessed) {
      log.trace(`Unknown tx: Skipping already processed transaction ${tx.id} from ${tx.senderId}.`);
      return;
    }

    log.log(`Unknown tx: Processing message from ${tx.senderId} (transaction ${tx.id}).`);

    const { incomingTxsDb } = db;
    const lookbackSince = utils.unixTimeStampMs() - UNKNOWN_TX_LOOKBACK_MS;

    const docs = await incomingTxsDb.db
        .find({
          senderId: tx.senderId,
          type: 'unknown',
          date: { $gt: lookbackSince },
        })
        .sort({ date: -1 })
        .toArray();

    const sessionGapThreshold = utils.unixTimeStampMs() - UNKNOWN_TX_SESSION_GAP_MS;
    let recentUnknownCount = docs.length;

    // If there is no second message in the window, or the previous one is older than 2 hours,
    // treat this as the first message in a new conversation session.
    if (!docs[1] || sessionGapThreshold > docs[1].date) {
      recentUnknownCount = 1;
    }

    const msg = pickReplyMessage(recentUnknownCount);

    log.debug(
        `Unknown tx: Sender ${tx.senderId} has ${recentUnknownCount} recent unknown message(s) ` +
        `in the last 24h; chosen reply tier ${recentUnknownCount}.`,
    );

    const api = adamantApi();
    const response = await api.sendMessage(config.passPhrase, tx.senderId, msg);

    if (!response.success) {
      const details = 'errorMessage' in response ? response.errorMessage : 'No details.';
      log.warn(
          `Unknown tx: Failed to send reply to ${tx.senderId} for transaction ${tx.id}. ` +
          `${details || 'No details.'}`,
      );
      return;
    }

    await itx.update({ isProcessed: true }, true);

    log.log(`Unknown tx: Replied to ${tx.senderId} and marked transaction ${tx.id} as processed.`);
  } catch (error) {
    log.error(`Error in handleUnknownTx() of the ${moduleName} module: ${error}`);
  }
}

/**
 * Picks a bot reply based on how many recent unknown messages the sender posted.
 *
 * @param {number} recentUnknownCount Number of unknown messages in the lookback window
 * @returns {string} Message text to send back to the user
 */
function pickReplyMessage(recentUnknownCount) {
  if (recentUnknownCount === 1) {
    return config.welcome_string;
  }

  if (recentUnknownCount === 2) {
    return (
      'OK. It seems you don’t speak English. Contact my master and ask him to teach me 🎓 ' +
      'your native language. But note, it will take some time because I am not a genius 🤓.'
    );
  }

  if (recentUnknownCount === 3) {
    return 'Hm… Contact _not me_, but my master. No, I don’t know how to reach him. ADAMANT is so anonymous 🤪.';
  }

  if (recentUnknownCount === 4) {
    return 'I see… You just wanna talk 🗣️. I am not the best at talking.';
  }

  if (recentUnknownCount < 10) {
    return getRandomPhrase(0);
  }

  if (recentUnknownCount < 20) {
    return getRandomPhrase(1);
  }

  if (recentUnknownCount < 30) {
    return getRandomPhrase(2);
  }

  if (recentUnknownCount < 40) {
    return getRandomPhrase(3);
  }

  if (recentUnknownCount < 50) {
    return getRandomPhrase(4);
  }

  return getRandomPhrase(5);
}

/**
 * Returns a random phrase from one of the canned reply collections.
 *
 * @param {UnknownTxReplyCollectionIndex} collectionIndex Collection tier (0 = mildest)
 * @returns {string} Random phrase from the selected collection
 */
function getRandomPhrase(collectionIndex) {
  const phrases = UNKNOWN_TX_REPLY_COLLECTIONS[collectionIndex];
  const index = Math.floor(Math.random() * phrases.length);
  return phrases[index];
}

/** Canned reply pools; higher indices are used for more persistent unknown senders. */
const UNKNOWN_TX_REPLY_COLLECTIONS = [
  // Tier 0 — friendly nudges toward trading and ADAMANT features
  [
    'Do you want a beer 🍺? I want one too, but now it\'s trade time.',
    'Do you wanna trade Ethers? Say **/balances** to see what assets you have in your account 🤑.',
    'Aaaaghr…! 😱 Check out ₿ rates with the **/rates BTC** command right now!',
    'I can tell you how to use me. ℹ️ Just say **/help**.',
    'I am just kiddin! 😛',
    'I’d like to work with you 🈺.',
    'Ok, let\'s see… What about trading ADM? 🉐',
    'ADAMANT is cool 😎, isn’t it?',
    'People do know me. I am decent. 😎 Ask somebody to confirm.',
    'I am really good 👌 at trading deals.',
    'ADAMANT is perfect 💯. Read about it on their Blog.',
    'I recommend you read about how ADAMANT is private 🔒 and anonymous.',
    'To pick Emoji 😄, press Win + . on Windows, Cmd + Ctrl + Space on Mac, or use the keyboard on iPhone and Android.',
    'Your IP is hidden 🕵️ in ADAMANT, as all connections go through nodes, not directly as in P2P messengers.',
    'Blockchain offers unprecedented privacy and security 🔑, did you know?',
    'Wallet private keys 🔑 are in your full control in ADAMANT.',
    'Convenient. Anonymous. Reliable. Instant. Oh, it is me! 💱',
    'ADAMANT is open source, including myself 🤖. Join us to make me better! 📶',
    'Do you know what ADAMANT 2FA is?',
    'ADAMANT is soooo decentralized! And private! ❤️',
    'Do you want me to trade on more exchanges 💱? Ask my master!',
    'Recommend ADAMANT to your friends! 🌟',
    'If I were Satoshi, I’d rebuild Bitcoin ₿ on top of ADAMANT! 😍',
  ],
  // Tier 1
  [
    'Do you know what is ‘биток’?',
    'Yeah… my English was born in a cold ❄️ Russian village. I know. But my masters are good at programming 👨‍💻.',
    'I have been working for ADAMANT for some time already. I have to admit the guys feed me well. 🥪',
    'I love ADAMANT 💓. The team is doing its best.',
    'Да не барыга я! Зарабатываю как могу. 😬',
    'London is the capital of Great Britain. 🤔',
    'To pick Emoji 😄, press Win + . on Windows, Cmd + Ctrl + Space on Mac, or use the keyboard on iPhone and Android.',
    'My mama told me not to talk to strangers 🤐.',
    'Are you a girl or a boy? I am comfortable with girls 👧.',
    'Have you heard that ADAMANT is on Binance already? …I am not 🙃.',
    'When Binance? 😲',
    'No, no. It is not good.',
    'D’oh! 😖',
    'Как тебе блокчейн на 1С, Илон Маск? 🙃',
    'And how do you like Blockchain on 1С, Elon Musk? 🤷',
    'Type **/calc 1 BTC in USD** to see the Bitcoin price.',
    'ℹ️ Just say **/help** and I am here.',
    'Say **/rates ADM** and I will tell you all ADM prices 📈',
    '😛 I am just kiddin!',
    'Can with you that the not so? 😮',
  ],
  // Tier 2
  [
    'Talk less! 🤐',
    'No, I am not. 🙅‍♂️',
    'I am not a scammer! 😠',
    '1 ADM for 10 Ethers! 🤑 Deal! Buterin will understand soon who is the daddy.',
    '🔫 Гони бабло! 💰 …sorry for my native.',
    'Это у вас навар адский. А у меня… это комиссия за честную работу. 😬',
    'Ландон из э капитал оф грейт брит… блять, я перебрал… 🤣',
    '❤️ Love is everything.',
    'Hey… You disturb me! 💻 I am working!',
    'It seems you are good at talking 🗣️ only.',
    'OK. I better call you now 🤙',
    'I am not a motherf… how do you know such words, little? 👿',
    'Do you know Satoshi 🤝 is my close friend?',
    'Are you programming in 1С? Try it! ПроцессорВывода = Новый ПроцессорВыводаРезультатаКомпоновкиДанныхВТабличныйДокумент;',
    '👨‍💻',
    'And how do you like Blockchain on 1С, Elon Musk?',
    'And how do you like this, Elon Musk? 😅',
    'I am quiet now.',
    'I am just kiddin! 😆',
    'Can with you that the not so? 😅',
  ],
  // Tier 3
  [
    'My patience is over 😑.',
    'You want a ban, I think 🤨',
    'Just give me some money! 💱',
    'I am tired of you… ',
    'Booooooring! 💤',
    '💱 Stop talking, go working?',
    'To ADAMANT! 🥂',
    'Ща бы пивка и дернуть кого-нибудь 👯',
    'Да ну эту крипту! Пойдем гульнем лучше! 🕺🏻',
    'Хорошо, что тып арускин епо немаишь 😁 гыгыггыгыггы',
    'Try to translate this: ‘На хера мне без хера, если с хером до хера!’',
    'Do you know you can get a ban 🚫 for talking too much?',
    'Try to make blockchain in 1С! 😁 It is a Russian secret programming language. Google it.',
    'Onion darknet? 🤷 No, I haven\'t heard.',
    'Кэн виз ю зэт зэ нот соу?',
    'Yeah! Party time! 🎉',
    'Do you drink vodka? I do.',
    'Can with you that the not so? 🔥',
    'I am just kiddin! 😄',
  ],
  // Tier 4
  [
    'Shut up… 🤐',
    'I better find another trader 📱',
    'You want to be banned 🚫 for sure!',
    'Ok… I understood. Come back tomorrow.',
    'Who is it behind you? A real Satoshi!? 😮',
    'Can with you that the not so?',
    'Do you know this code entry called ‘shit’? Check it out in ADAMANT’s Github by yourself.',
    'УДОЛИЛ!!!!!!!!!1111111',
    'Some crazy guy taught me so many words to speak. Вот чо это за слово такое, таугхт? 🤦 Ёпт.',
    'Пошутили и хватит. Давайте к делу? ℹ️ Скажите **/help**, чтобы получить справку.',
    'I am here to trade, not to speak 😐',
    'While you talk, others make money.',
    'А-а-а-а-а-а! АДАМАНТ пампят! 😱',
    'Шоколотье, сомелье, залупэ… Привет Чиверсу 🤘',
    'Делаем ставки. 🍽️ Макафи съест свой член?',
    'Ban-ban-ban… 🚫',
    'АСТАНАВИТЕСЬ!',
    'Ё and Е are different letters. Don\'t confuse them, English speaker!',
  ],
  // Tier 5
  [
    '🐻 and 🐂 are those who make the market.',
    'I am hungry 🍲 now. Are you with me?',
    'To ADAMANT! 🥂',
    '🍾 Happy trading!',
    'Who is it behind you? A real Satoshi!? 😮',
    'Can with you that the not so?',
    'Can you play 🎹? I do. No, I will not play for free.',
    'I would like to live on a 🏝️. But reality is so cruel.',
    'Look! ADM is pumping! 🎉',
    'Do you know that in my time computers were big and used floppy disks? 💾',
    'Hurry up! ADAMANT pump! 📈',
    'Биток уже за сотку тыщ баксов!?',
    'Давай уже к сделке. Нипонил как? Пешы **/help**.',
    'There will be a time when 1 ADM = 10 BTC 🤑',
    'Try me! I can do it! 🙂',
    'Do you think Bitcoin SV is a scam?',
    'I like trading. Let\'s make a deal right now! 🉐',
    'Не, ну это слишком. 🤩',
  ],
];

/** @type {HandleUnknownTx} */
module.exports = handleUnknownTx;
