import type { FormStore } from '@maxwell/core/stores/forms';
import type { Platform } from '../../platform/types.js';
import type { PrivacyHandler } from '../../runtime/privacy.js';
import type { FormRunner } from './sessions.js';

const REASON = 'Maxwell forms: member data removed';

export function formPrivacy(
  store: FormStore,
  runner: FormRunner,
  platform: Platform,
): PrivacyHandler {
  return {
    async export(guildId, userId) {
      const submissions = await store.memberSubmissions(guildId, userId);
      const session = await store.session(userId);
      const votes = await store.memberVotes(guildId, userId);
      const active = session?.guildId === guildId ? session : null;
      if (submissions.length === 0 && !active && votes.length === 0) return null;
      return {
        submissions: submissions.map((submission) => ({
          id: submission.id,
          number: submission.number,
          form: submission.formName,
          status: submission.status,
          answers: submission.answers.map((answer) => ({
            question: answer.label,
            answer: answer.display,
          })),
          note: submission.note,
          createdAt: submission.createdAt,
          decidedAt: submission.decidedAt,
        })),
        session: active
          ? {
              form: active.formId,
              mode: active.mode,
              answers: active.answers,
              startedAt: active.startedAt,
              expiresAt: active.expiresAt,
            }
          : null,
        reviewVotes: votes,
      };
    },
    async forget(guildId, userId) {
      await runner.forget(guildId, userId);
      const { reviewMessages } = await store.forgetMember(guildId, userId);
      for (const { channelId, messageId } of reviewMessages) {
        await platform.delete(channelId, messageId, REASON).catch(() => {});
      }
    },
  };
}
