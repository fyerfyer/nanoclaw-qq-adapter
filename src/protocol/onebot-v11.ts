/**
 * OneBot v11 protocol types used by the NapCat adapter.
 *
 * The adapter assumes NapCat is configured with `messagePostFormat: 'array'`,
 * so all message fields are represented as segment arrays.
 */

export type MessageSegment =
  | TextSegment
  | AtSegment
  | ImageSegment
  | RecordSegment
  | FileSegment
  | ReplySegment
  | UnknownSegment;

export interface TextSegment {
  type: 'text';
  data: {
    text: string;
  };
}

export interface AtSegment {
  type: 'at';
  data: {
    qq: string | number;
    name?: string;
  };
}

export interface ImageSegment {
  type: 'image';
  data: {
    file: string;
    url?: string;
    type?: string;
    name?: string;
  } & Record<string, unknown>;
}

export interface RecordSegment {
  type: 'record';
  data: {
    file: string;
    url?: string;
    name?: string;
  } & Record<string, unknown>;
}

export interface FileSegment {
  type: 'file';
  data: {
    file: string;
    url?: string;
    name?: string;
  } & Record<string, unknown>;
}

export interface ReplySegment {
  type: 'reply';
  data: {
    id: string | number;
  };
}

export interface UnknownSegment {
  type: string;
  data: Record<string, unknown>;
}

export interface SenderInfo {
  user_id: number;
  nickname: string;
  card?: string;
  sex?: string;
  age?: number;
  role?: string;
  title?: string;
}

export type OneBotEvent =
  | PrivateMessageEvent
  | GroupMessageEvent
  | GroupIncreaseNoticeEvent
  | GroupDecreaseNoticeEvent
  | HeartbeatMetaEvent
  | UnknownEvent;

export interface BaseEvent {
  time: number;
  self_id: number;
  post_type: string;
}

export interface PrivateMessageEvent extends BaseEvent {
  post_type: 'message';
  message_type: 'private';
  sub_type: 'friend' | 'group' | 'other';
  message_id: number;
  user_id: number;
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: SenderInfo;
}

export interface GroupMessageEvent extends BaseEvent {
  post_type: 'message';
  message_type: 'group';
  sub_type: 'normal' | 'anonymous' | 'notice';
  message_id: number;
  group_id: number;
  user_id: number;
  anonymous?: {
    id: number;
    name: string;
    flag: string;
  };
  message: MessageSegment[];
  raw_message: string;
  font: number;
  sender: SenderInfo;
}

export interface GroupIncreaseNoticeEvent extends BaseEvent {
  post_type: 'notice';
  notice_type: 'group_increase';
  sub_type: 'approve' | 'invite';
  group_id: number;
  operator_id: number;
  user_id: number;
}

export interface GroupDecreaseNoticeEvent extends BaseEvent {
  post_type: 'notice';
  notice_type: 'group_decrease';
  sub_type: 'leave' | 'kick' | 'kick_me';
  group_id: number;
  operator_id: number;
  user_id: number;
}

export interface HeartbeatMetaEvent extends BaseEvent {
  post_type: 'meta_event';
  meta_event_type: 'heartbeat';
  status: Record<string, unknown>;
  interval: number;
}

export interface UnknownEvent extends BaseEvent {
  post_type: string;
  [key: string]: unknown;
}

export interface OneBotActionRequest<T = unknown> {
  action: string;
  params: T;
  echo?: string;
}

export interface OneBotActionResponse<T = unknown> {
  status: string;
  retcode: number;
  data: T;
  message: string;
  wording?: string;
  echo?: string;
}

export interface LoginInfo {
  user_id: number;
  nickname: string;
}

export interface SendPrivateMsgParams {
  user_id: number;
  message: MessageSegment[];
  auto_escape?: boolean;
}

export interface SendGroupMsgParams {
  group_id: number;
  message: MessageSegment[];
  auto_escape?: boolean;
}

export interface SetGroupBanParams {
  group_id: number;
  user_id: number;
  duration?: number;
}

export interface SetGroupKickParams {
  group_id: number;
  user_id: number;
  reject_add_request?: boolean;
}

export interface GetStatusResult {
  online: boolean | null;
  good: boolean;
}

export type OneBotApiResult =
  | { message_id: number }
  | LoginInfo
  | GetStatusResult
  | Record<string, unknown>
  | null;

export const ACTIONS = {
  SEND_PRIVATE_MSG: 'send_private_msg',
  SEND_GROUP_MSG: 'send_group_msg',
  GET_LOGIN_INFO: 'get_login_info',
  GET_STATUS: 'get_status',
  SET_GROUP_BAN: 'set_group_ban',
  SET_GROUP_KICK: 'set_group_kick',
} as const;

export function isTextSegment(seg: MessageSegment): seg is TextSegment {
  return seg.type === 'text';
}

export function isAtSegment(seg: MessageSegment): seg is AtSegment {
  return seg.type === 'at';
}

export function isImageSegment(seg: MessageSegment): seg is ImageSegment {
  return seg.type === 'image';
}

export function isRecordSegment(seg: MessageSegment): seg is RecordSegment {
  return seg.type === 'record';
}

export function isFileSegment(seg: MessageSegment): seg is FileSegment {
  return seg.type === 'file';
}

export function isReplySegment(seg: MessageSegment): seg is ReplySegment {
  return seg.type === 'reply';
}

export function isPrivateMessageEvent(
  event: OneBotEvent,
): event is PrivateMessageEvent {
  return (
    event.post_type === 'message' &&
    (event as PrivateMessageEvent).message_type === 'private'
  );
}

export function isGroupMessageEvent(
  event: OneBotEvent,
): event is GroupMessageEvent {
  return (
    event.post_type === 'message' &&
    (event as GroupMessageEvent).message_type === 'group'
  );
}

export function isHeartbeatEvent(
  event: OneBotEvent,
): event is HeartbeatMetaEvent {
  return (
    event.post_type === 'meta_event' &&
    (event as HeartbeatMetaEvent).meta_event_type === 'heartbeat'
  );
}

export function isGroupIncreaseEvent(
  event: OneBotEvent,
): event is GroupIncreaseNoticeEvent {
  return (
    event.post_type === 'notice' &&
    (event as GroupIncreaseNoticeEvent).notice_type === 'group_increase'
  );
}

export function isGroupDecreaseEvent(
  event: OneBotEvent,
): event is GroupDecreaseNoticeEvent {
  return (
    event.post_type === 'notice' &&
    (event as GroupDecreaseNoticeEvent).notice_type === 'group_decrease'
  );
}
