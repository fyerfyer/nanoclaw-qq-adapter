/**
 * Handles OneBot v11 notice events such as group member increase/decrease.
 */

import type { NapcatConfig } from '../config.js';
import type { OneBotWsClient } from '../client/onebot-ws-client.js';
import {
  ACTIONS,
  isGroupIncreaseEvent,
  isGroupDecreaseEvent,
  type OneBotEvent,
  type OneBotApiResult,
} from '../protocol/onebot-v11.js';

export interface NoticeContext {
  config: NapcatConfig;
  client: OneBotWsClient;
}

export async function handleNoticeEvent(
  ctx: NoticeContext,
  event: OneBotEvent,
): Promise<void> {
  if (isGroupIncreaseEvent(event)) {
    if (!ctx.config.welcomeMessage) return;
    const text = ctx.config.welcomeMessage.replace(
      /\{user_id\}/g,
      String(event.user_id),
    );
    await sendGroupMessage(ctx.client, event.group_id, text);
    return;
  }

  if (isGroupDecreaseEvent(event)) {
    if (!ctx.config.goodbyeMessage) return;
    const text = ctx.config.goodbyeMessage.replace(
      /\{user_id\}/g,
      String(event.user_id),
    );
    await sendGroupMessage(ctx.client, event.group_id, text);
    return;
  }
}

async function sendGroupMessage(
  client: OneBotWsClient,
  groupId: number,
  text: string,
): Promise<void> {
  await client.call<OneBotApiResult>(ACTIONS.SEND_GROUP_MSG, {
    group_id: groupId,
    message: [{ type: 'text', data: { text } }],
  });
}
