export interface UpdateParticipant {
  busy: () => string
  save: () => Promise<void>
  close: () => Promise<void>
}

export async function prepareUpdateParticipants(participants: UpdateParticipant[], stage: 'save' | 'close') {
  if (!participants.length) throw new Error('工作台尚未准备好，请稍后重试')
  const assertIdle = () => {
    const reason = participants.map(participant => participant.busy()).find(Boolean)
    if (reason) throw new Error(reason)
  }
  assertIdle()
  for (const participant of participants) {
    await participant[stage]()
    assertIdle()
  }
}
