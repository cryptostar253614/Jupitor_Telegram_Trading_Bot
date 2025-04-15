import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import * as dotenv from "dotenv";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  NATIVE_MINT,
} from "@solana/spl-token";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { publicKey } from "@raydium-io/raydium-sdk";
dotenv.config();

const connection = new Connection(process.env.RPC_URL!, "confirmed");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: true });
(async () => {
  await bot.setMyCommands([{ command: "start", description: "Start the bot" }]);
})();

const users = new Map();

bot.onText(/\/(start|help)/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome! Use the buttons below to interact with the bot:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
            { text: "🎯 Setup Token", callback_data: "setuptoken" },
          ],
          [
            { text: "🛒 Buy", callback_data: "buy" },
            { text: "💰 Sell", callback_data: "sell" },
          ],
          [{ text: "📊 Balance", callback_data: "balance" }],
        ],
      },
    }
  );
});

bot.on("callback_query", async (query) => {
  const chatId = query.message!.chat.id;
  const action = query.data!;

  if (action.startsWith("sell_")) {
    const percent = parseInt(action.replace("sell_", ""));

    if (isNaN(percent)) {
      return bot.sendMessage(chatId, "Invalid sell percentage.");
    }
    const user = users.get(chatId);
    if (!user?.wallet) {
      return bot.sendMessage(chatId, "Wallet not set up yet.");
    }
    const wallet = user.wallet;
    const tokenAddress = users.get(chatId).token;
    const tokenBalance = await getTokenBalance(
      wallet.publicKey,
      new PublicKey(tokenAddress)
    );

    const sellBalance = Math.floor(
      (Number(tokenBalance) * Number(percent)) / Number(100)
    );

    try {
      await sellCrypto(wallet, tokenAddress, sellBalance);

      // Implement actual sell logic here based on `percent`
      bot.sendMessage(chatId, `Sold ${percent}% of token (mocked).`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
              { text: "🎯 Setup Token", callback_data: "setuptoken" },
            ],
            [
              { text: "🛒 Buy", callback_data: "buy" },
              { text: "💰 Sell", callback_data: "sell" },
            ],
            [{ text: "📊 Balance", callback_data: "balance" }],
          ],
        },
      });
    } catch (error: any) {
      bot.sendMessage(chatId, "Error: " + error.message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
              { text: "🎯 Setup Token", callback_data: "setuptoken" },
            ],
            [
              { text: "🛒 Buy", callback_data: "buy" },
              { text: "💰 Sell", callback_data: "sell" },
            ],
            [{ text: "📊 Balance", callback_data: "balance" }],
          ],
        },
      });
      return;
    }
  }

  switch (action) {
    case "setupwallet":
      bot.sendMessage(
        chatId,
        "🔐 Please send your **private key** (base58 format):",
        { parse_mode: "Markdown" }
      );
      users.set(chatId, { ...users.get(chatId), step: "awaiting_private_key" });
      break;
    case "setuptoken":
      bot.sendMessage(chatId, "Please enter the token address:");
      users.set(chatId, { ...users.get(chatId), step: "awaiting_token" });
      break;
    case "buy":
      bot.sendMessage(chatId, "Enter the amount of SOL to spend:");
      users.set(chatId, { ...users.get(chatId), step: "awaiting_buy_amount" });
      break;
    case "sell":
      bot.sendMessage(chatId, "💰 Select how much you'd like to sell:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "20% 🔻", callback_data: "sell_20" },
              { text: "50% ⚖️", callback_data: "sell_50" },
            ],
            [
              { text: "70% 📉", callback_data: "sell_70" },
              { text: "100% 🚨", callback_data: "sell_100" },
            ],
          ],
        },
      });
      break;
    case "balance":
      const user = users.get(chatId);
      if (!user?.wallet) {
        return bot.sendMessage(chatId, "Wallet not set up yet.");
      }
      if (!user?.token) {
        return bot.sendMessage(chatId, "Token not set up yet.");
      }
      const solBalance = await connection.getBalance(user.wallet.publicKey);
      const tokenBalance = await getTokenBalance(
        user.wallet.publicKey,
        new PublicKey(user.token)
      );
      bot.sendMessage(
        chatId,
        `💼 *Your Wallet Balance:*\n\n💸 SOL: \`${(solBalance / 1e9).toFixed(
          4
        )}\`\n🎯 Token: \`${tokenBalance}\``,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
                { text: "🎯 Setup Token", callback_data: "setuptoken" },
              ],
              [
                { text: "🛒 Buy", callback_data: "buy" },
                { text: "💰 Sell", callback_data: "sell" },
              ],
              [{ text: "📊 Balance", callback_data: "balance" }],
            ],
          },
        }
      );
      break;
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text!;
  const user = users.get(chatId);

  if (!user?.step) return;

  if (user.step === "awaiting_private_key") {
    try {
      const secretKey = bs58.decode(text);
      const wallet = Keypair.fromSecretKey(secretKey);
      users.set(chatId, { ...user, wallet, step: null });
      bot.sendMessage(chatId, "✅ Wallet set successfully!", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
              { text: "🎯 Setup Token", callback_data: "setuptoken" },
            ],
            [
              { text: "🛒 Buy", callback_data: "buy" },
              { text: "💰 Sell", callback_data: "sell" },
            ],
            [{ text: "📊 Balance", callback_data: "balance" }],
          ],
        },
      });
    } catch {
      bot.sendMessage(chatId, "Invalid private key. Try again.");
    }
  } else if (user.step === "awaiting_token") {
    try {
      const token = new PublicKey(text);
      users.set(chatId, { ...user, token: token.toString(), step: null });
      bot.sendMessage(chatId, `Token set to: \`${token.toString()}\``, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
              { text: "🎯 Setup Token", callback_data: "setuptoken" },
            ],
            [
              { text: "🛒 Buy", callback_data: "buy" },
              { text: "💰 Sell", callback_data: "sell" },
            ],
            [{ text: "📊 Balance", callback_data: "balance" }],
          ],
        },
      });
    } catch {
      bot.sendMessage(chatId, "Invalid token address. Try again.");
    }
  } else if (user.step === "awaiting_buy_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount)) {
      return bot.sendMessage(chatId, "Invalid amount. Try again.");
    }
    if (!user?.wallet) {
      return bot.sendMessage(chatId, "Wallet not set up yet.");
    }
    const amountLamports = amount * 1e9;
    const tokenAddress = user.token;
    try {
      await buyCrypto(user.wallet, tokenAddress, amountLamports);
      // Implement actual buy logic here
      users.set(chatId, { ...user, step: null });
      bot.sendMessage(
        chatId,
        `Successfully buy token for ${amount} SOL (mocked).`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
                { text: "🎯 Setup Token", callback_data: "setuptoken" },
              ],
              [
                { text: "🛒 Buy", callback_data: "buy" },
                { text: "💰 Sell", callback_data: "sell" },
              ],
              [{ text: "📊 Balance", callback_data: "balance" }],
            ],
          },
        }
      );
    } catch (error: any) {
      bot.sendMessage(chatId, "Error: " + error.message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔐 Setup Wallet", callback_data: "setupwallet" },
              { text: "🎯 Setup Token", callback_data: "setuptoken" },
            ],
            [
              { text: "🛒 Buy", callback_data: "buy" },
              { text: "💰 Sell", callback_data: "sell" },
            ],
            [{ text: "📊 Balance", callback_data: "balance" }],
          ],
        },
      });
      return;
    }
  }
});

async function buyCrypto(wallet: Keypair, token: string, amount: number) {
  console.log(wallet.publicKey.toBase58(), token, amount);
  const quoteResponse = await (
    await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${token}&amount=${amount}&slippageBps=50&restrictIntermediateTokens=true`
    )
  ).json();

  //   console.log(quoteResponse);
  const swapResponse = await (
    await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSOL: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 10000000,
            global: false,
            priorityLevel: "high",
          },
        },
      }),
    })
  ).json();
  //   console.log(swapResponse);

  const transactionBase64 = swapResponse.swapTransaction;
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(transactionBase64, "base64")
  );

  transaction.sign([wallet]);

  const transactionBinary = transaction.serialize();

  const signature = await connection.sendRawTransaction(transactionBinary, {
    maxRetries: 2,
    skipPreflight: true,
  });
  //   const confirmation = await connection.confirmTransaction(
  //     signature,
  //     "finalized"
  //   );
  //   console.log("Buy: ", signature);
}

async function sellCrypto(wallet: Keypair, token: string, amount: number) {
  console.log(wallet.publicKey.toBase58(), token, amount);
  const quoteResponse = await (
    await fetch(
      `https://lite-api.jup.ag/swap/v1/quote?inputMint=${token}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=50&restrictIntermediateTokens=true`
    )
  ).json();

  const swapResponse = await (
    await fetch("https://lite-api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSOL: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 10000000,
            global: false,
            priorityLevel: "high",
          },
        },
      }),
    })
  ).json();

  const transactionBase64 = swapResponse.swapTransaction;
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(transactionBase64, "base64")
  );

  transaction.sign([wallet]);

  const transactionBinary = transaction.serialize();

  const signature = await connection.sendRawTransaction(transactionBinary, {
    maxRetries: 2,
    skipPreflight: true,
  });
  //   const confirmation = await connection.confirmTransaction(
  //     signature,
  //     "finalized"
  //   );
  //   console.log("Sell: ", signature);
}

async function getTokenBalance(wallet: PublicKey, mint: PublicKey) {
  const ata = await getAssociatedTokenAddress(mint, wallet);
  try {
    const account = await getAccount(connection, ata);
    return Number(account.amount); // Token balance
  } catch (e) {
    return 0; // If the account doesn't exist, balance is 0
  }
}
