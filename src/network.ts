import WebSocket from 'ws';
import {
  getAccumulatedDifficulty,
  getLatestBlock,
  isValidBlockStructure,
  isValidChain,
  isValidNewBlock,
} from './blockchain';
import { initialPeers, p2pPort } from './config';
import { MESSAGE_TYPE, RECONNECT_TIME } from './constant';
import { Block, Blockchain, PeerMessage } from './types';
import { getAccounts, replaceAccounts } from './state/account';
import { getAssets, replaceAssets } from './state/assets';
import { getBlockchain } from './history';
import { getEscrows, replaceEscrows } from './state/escrow';

const sockets = [];
let reconnectTimeout;

export function responseChainMsg(blockchain: Blockchain): PeerMessage {
  return {
    type: MESSAGE_TYPE.RESPONSE_BLOCKCHAIN,
    data: JSON.stringify(blockchain),
    accounts: JSON.stringify(getAccounts()),
    assets: JSON.stringify(getAssets()),
    escrow: JSON.stringify(getEscrows()),
  };
}

export function responseLatestMsg(blockchain: Blockchain): PeerMessage {
  return {
    type: MESSAGE_TYPE.RESPONSE_BLOCKCHAIN,
    data: JSON.stringify([getLatestBlock(blockchain)]),
    accounts: JSON.stringify(getAccounts()),
    assets: JSON.stringify(getAssets()),
    escrow: JSON.stringify(getEscrows()),
  };
}

export function queryAllMsg(): PeerMessage {
  return {
    type: MESSAGE_TYPE.QUERY_ALL,
    data: '',
    accounts: '',
    assets: '',
    escrow: '',
  };
}

export function queryChainLengthMsg(): PeerMessage {
  return {
    type: MESSAGE_TYPE.QUERY_LATEST,
    data: '',
    accounts: '',
    assets: '',
    escrow: '',
  };
}

function replaceChain(newBlocks: Blockchain, blockchain: Blockchain): void {
  if (
    isValidChain(newBlocks) &&
    getAccumulatedDifficulty(newBlocks) > getAccumulatedDifficulty(blockchain)
  ) {
    console.log(
      'Received blockchain is valid. Replacing current blockchain with received blockchain',
    );
    getBlockchain(newBlocks);
    broadcast(responseLatestMsg(newBlocks));
  } else {
    console.log('Received blockchain invalid');
  }
}

function handleReplaceAccounts(accountMessage: string): void {
  const newAssetsAccount = JSON.parse(accountMessage);
  Object.keys(newAssetsAccount).forEach((assetId: string) => {
    replaceAccounts(newAssetsAccount[assetId], assetId);
  });
}

function handleReplaceEscrow(escrowMessage: string): void {
  const newEscrows = JSON.parse(escrowMessage);
  replaceEscrows(newEscrows);
}

function handleReplaceAssets(assetMessage: string): void {
  const newAssets = JSON.parse(assetMessage);
  replaceAssets(newAssets);
}

function handleBlockchainResponse(
  message: PeerMessage,
  blockchain: Blockchain,
): void {
  const receivedBlocks = JSON.parse(message.data).sort(
    (b1: Block, b2: Block) => b1.index - b2.index,
  );
  if (receivedBlocks.length === 0) {
    console.log('received block chain size of 0');
    return;
  }

  const latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
  if (!isValidBlockStructure(latestBlockReceived)) {
    console.log('block structure not valid');
    return;
  }

  const latestBlockHeld = getLatestBlock(blockchain);
  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log(
      'blockchain possibly behind. We got: ' +
        latestBlockHeld.index +
        ' Peer got: ' +
        latestBlockReceived.index,
    );
    if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
      if (isValidNewBlock(latestBlockReceived, getLatestBlock(blockchain))) {
        console.log('We can append the received block to our chain');
        blockchain.push(latestBlockReceived);
        broadcast(responseLatestMsg(blockchain));

        handleReplaceAccounts(message.accounts);
        handleReplaceAssets(message.assets);
        handleReplaceEscrow(message.escrow);
      }
    } else if (receivedBlocks.length === 1) {
      console.log('We have to query the chain from our peer');
      broadcast(queryAllMsg());

      handleReplaceAccounts(message.accounts);
      handleReplaceAssets(message.assets);
      handleReplaceEscrow(message.escrow);
    } else {
      console.log('Received blockchain is longer than current blockchain');
      replaceChain(receivedBlocks, blockchain);
    }
  } else {
    console.log(
      'received blockchain is not longer than current blockchain. Do nothing',
    );
  }
}

function write(ws: WebSocket, message: PeerMessage): void {
  ws.send(JSON.stringify(message));
}

export function broadcast(message: PeerMessage) {
  sockets.forEach((socket: WebSocket) => {
    write(socket, message);
  });
}

function initMessageHandler(ws: WebSocket, blockchain: Blockchain): void {
  ws.on('message', (data: string) => {
    const message = JSON.parse(data);
    console.log('Received message' + JSON.stringify(message));
    switch (message.type) {
      case MESSAGE_TYPE.QUERY_LATEST:
        write(ws, responseLatestMsg(blockchain));
        break;
      case MESSAGE_TYPE.QUERY_ALL:
        write(ws, responseChainMsg(blockchain));
        break;
      case MESSAGE_TYPE.RESPONSE_BLOCKCHAIN:
        handleBlockchainResponse(message, blockchain);
        break;
    }
  });
}

function initErrorHandler(ws: WebSocket): void {
  const closeConnection = (ws: WebSocket) => {
    console.log('connection failed to peer: ' + ws.url);
    sockets.splice(sockets.indexOf(ws), 1);

    const reconnect = () => {
      connectToPeers(initialPeers, getBlockchain());
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(reconnect, RECONNECT_TIME);
    };
    reconnect();
  };
  ws.on('close', () => closeConnection(ws));
  ws.on('error', () => closeConnection(ws));
}

function initConnection(ws: WebSocket, blockchain: Blockchain): void {
  sockets.push(ws);
  initMessageHandler(ws, blockchain);
  initErrorHandler(ws);
  write(ws, queryChainLengthMsg());
}

export function getPeers(): string[] {
  return sockets.map((socket: any) => {
    return `${socket._socket.remoteAddress}:${socket._socket.remotePort}`;
  });
}

export function connectToPeers(
  newPeers: string[],
  blockchain: Blockchain,
): void {
  newPeers.forEach((peer: string) => {
    const ws = new WebSocket(peer);
    ws.on('open', () => {
      initConnection(ws, blockchain);
      clearTimeout(reconnectTimeout);
    });
    ws.on('error', () => {
      console.log('connection failed');
    });
  });
}

export function initP2PServer(blockchain: Blockchain) {
  const server = new WebSocket.Server({ port: +p2pPort });
  server.on('connection', (ws: WebSocket) => {
    initConnection(ws, blockchain);
    console.log('listening websocket p2p port on: ' + p2pPort);
  });
}
