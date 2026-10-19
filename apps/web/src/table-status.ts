import type { RoomView } from '@nanjing-mahjong/shared-types';

export function tableStatus(
  room: RoomView,
  connected: boolean,
  pending: boolean,
  confirmationUnknown = false,
): { title: string; hint: string } {
  const name = (seat: number) => room.players[seat]?.name ?? '玩家';
  if (!connected)
    return { title: '正在重连并恢复房间状态', hint: '连接恢复前暂不能操作，请等待服务端同步' };
  if (room.paused) {
    const offline = room.players
      .filter((player) => player && !player.connected)
      .map((player) => player!.name)
      .join('、');
    return {
      title: '牌局已暂停 · 等待重连',
      hint: `等待${offline || '离线玩家'}重连，座位与牌局已保留`,
    };
  }
  if (pending) return { title: '正在提交操作…', hint: '等待服务端确认，请勿重复提交' };
  if (room.result) {
    const ready = room.nextHandReady ?? [];
    const waiting = room.players
      .filter((player) => player && !ready.includes(player.seat))
      .map((player) => player!.name)
      .join('、');
    return {
      title: `${room.result} · ${room.nextHandToken ? '等待下一手确认' : '本手已结束'}`,
      hint: room.nextHandToken
        ? `${ready.includes(room.self) ? '你已确认' : '请确认开始下一手'} · ${ready.length}/${room.players.length} 已确认${waiting ? `，等待${waiting}` : ''}${room.nextHandSeconds !== null ? ` · ${room.nextHandSeconds} 秒后自动开始` : ''}`
        : '本手已结算',
    };
  }
  if (confirmationUnknown)
    return { title: '尚未收到操作确认', hint: '请使用“重试操作”确认原请求，暂不能提交新操作' };
  if (room.phase === 'waiting-for-reaction') {
    const window = room.responseWindow;
    const trigger = window ? name(window.actorSeat) : '';
    return {
      title:
        window?.source === 'bu-gang'
          ? `${trigger}声明补杠 · 等待抢补杠胡响应`
          : window?.source === 'discard'
            ? `${trigger}已出${room.lastDiscard?.label ?? '牌'} · 等待弃牌响应`
            : '等待牌桌响应',
      hint: room.actions.choices.length ? '请选择响应操作' : '等待其他玩家响应，由服务端统一裁决',
    };
  }
  if (room.phase === 'waiting-for-di-hu-decision')
    return {
      title: '开局确认中',
      hint: room.actions.choices.length ? '请选择报地胡或不报' : '等待开局确认完成',
    };
  if (room.phase === 'waiting-for-draw')
    return { title: '服务端正在处理摸牌', hint: '请等待最新牌局状态' };
  if (room.phase === 'waiting-for-discard' && room.current !== null)
    return room.current === room.self
      ? {
          title: '轮到你出牌',
          hint: room.actions.choices.some((choice) => choice.kind === 'discard')
            ? '请选出一张手牌，或选择其他合法操作'
            : '请选择当前合法操作',
        }
      : { title: `等待 ${name(room.current)} 出牌`, hint: '请等待当前玩家完成操作' };
  return { title: '正在同步牌局状态', hint: '请等待服务端更新' };
}
