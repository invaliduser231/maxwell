import { formatDuration } from '../../commands/duration.js';
import { mention } from '../../commands/mentions.js';
import { count, plural } from '../../ui/format.js';
import type { InvitesCopy } from './copy.js';

const de: InvitesCopy = {
  commands: {
    invites: 'Wie viele Mitglieder jemand hergebracht hat.',
    top: 'Wer die meisten Mitglieder hergebracht hat, die geblieben sind.',
    who: 'Wie ein Mitglied hergekommen ist und wer es eingeladen hat.',
    log: 'Postet jeden Beitritt mit seiner Einladung in einen Kanal.',
  },
  top: {
    empty: [
      'Noch hat niemand jemanden hergebracht.',
      'Die Liste ist leer. Irgendwer muss anfangen.',
      'Noch keine Einladungen auf der Liste. Ruhig hier.',
    ],
    you: (rank: number, active: number) =>
      `Du: #${rank} mit ${plural(active, 'Mitglied', 'Mitgliedern')}`,
    notOnBoard: 'Du stehst noch nicht auf der Liste',
    title: 'Top-Einlader',
    left: (n: number) => `${count(n)} weg`,
  },
  who: {
    before: (who: string) => `${who} war schon vor mir da, deshalb weiß ich nicht, wie.`,
    looking: (who: string, when: string) =>
      `${who} ist ${when} beigetreten. Ich schaue noch nach, wie.`,
    unknown: (who: string, when: string) =>
      `${who} ist ${when} beigetreten. Fluxer hat mir nicht verraten, wie.`,
    through: (who: string, when: string, source: string) =>
      `${who} ist ${when} über ${source} beigetreten.`,
  },
  log: {
    current: (channel: string) => `Beitritte landen in ${channel}.`,
    off: 'Beitrittsposts sind aus.',
    turnOn: (prefix: string) => `Einschalten mit ${prefix}invites log #kanal.`,
    notChannel: 'Diesen Kanal sehe ich nicht.',
    where: (channel: string) => `in ${channel}`,
    set: (channel: string) => `Beitritte landen ab jetzt in ${channel}.`,
  },
  stats: {
    selfEmpty: ['Du hast noch niemanden hergebracht.', 'Über dich ist noch niemand gekommen.'],
    otherEmpty: (who: string) => `${who} hat noch niemanden hergebracht.`,
    you: 'Du',
    stayedOne: 'Ist geblieben.',
    stayedAll: 'Alle sind geblieben.',
    stillHere: (n: number) => `${count(n)} sind noch da.`,
    brought: (subject: string, total: number, stayed: string) =>
      `${subject} hat **${plural(total, 'Mitglied', 'Mitglieder')}** hergebracht. ${stayed}`,
    leftAgain: (n: number) => `${count(n)} wieder gegangen`,
  },
  source: {
    inviteFrom: (code: string, inviterId: string) => `\`${code}\` von ${mention.user(inviterId)}`,
    invite: 'eine Einladung',
    vanity: 'den Vanity-Link',
    discovery: 'Discovery',
    bot: 'eine Bot-Einladung',
    creator: 'das Erstellen der Community',
    admin: 'einen Instanz-Admin',
    unknown: 'einen unbekannten Weg',
  },
  join: {
    through: (who: string, source: string) => `${who} ist über ${source} beigetreten.`,
    plain: (who: string) => `${who} ist beigetreten.`,
    needsPermission: 'Ich brauche Manage Community, um die Einladung zu sehen.',
    notTold: 'Fluxer hat mir nicht verraten, welche Einladung es war.',
    botTitle: 'Bot hinzugefügt',
    memberTitle: 'Neues Mitglied',
    inviterNow: (inviter: string, active: number) =>
      `${inviter} hat jetzt **${plural(active, 'Mitglied', 'Mitglieder')}** hier.`,
    created: 'Konto erstellt',
    young: (age: number) => `Das Konto ist erst ${formatDuration(age)} alt.`,
    number: (n: number) => `Mitglied #${count(n)}`,
  },
};

export default de;
