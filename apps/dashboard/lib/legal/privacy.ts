export const privacy = `
# Privacy Policy

Last updated: 2026-10-26

## 1. Summary

- Maxwell is a free bot for the chat platform [Fluxer](https://fluxer.app) with a web dashboard. There are no ads and no analytics or tracking tools. Fonts are served by the dashboard itself.
- Maxwell only processes data in communities where it was invited. The admins of a community decide which modules are on and how they are set up.
- **Maxwell runs on servers in the United States.** The hosting provider is FluxerHost (Northwest Intelligence Solutions LLC) (USA). Section 12 explains how we safeguard the transfer.
- Members can export what Maxwell stores about them in a community with **m!mydata** and delete most of it with **m!forgetme** (section 9).

## 2. Controller

Rainer Schnittert
Tannenstr. 8
90762 Fürth
Germany
Email: [rainer@schnittert.com](mailto:rainer@schnittert.com)

Maxwell is run privately.

## 3. Visiting the website

The website and the dashboard are served from our servers. Our application writes no access logs and stores no IP addresses. The server cluster of our hosting provider may record technical connection data (IP address, time, requested address) to operate the network; we do not evaluate it.

- **Purpose:** delivering the website and protecting it against attacks.
- **Legal basis:** Art. 6(1)(f) GDPR. Our legitimate interest is a secure and available service.

Pictures of Fluxer users, communities and custom emojis are loaded into your browser directly from Fluxer's media servers (fluxerusercontent.com, fluxerstatic.com), so Fluxer sees your IP address.

## 4. Signing in to the dashboard

You sign in with your Fluxer account (OAuth2, scopes "identify" and "guilds"). Fluxer sends us your user ID, username, display name, avatar and the list of communities you are in. We store this with your session, together with the access and refresh token from Fluxer. The tokens are encrypted (AES-256-GCM). The session key itself is stored only as a hash.

- **Purpose:** recognizing you and showing the communities you may manage.
- **Legal basis:** Art. 6(1)(b) GDPR.
- **Retention:** 30 days or until you sign out. Signing out deletes the session and revokes the token at Fluxer. Expired sessions are deleted the next time someone signs in.

### Cookies

- **mx_session:** keeps you signed in; 30 days or until you sign out. HttpOnly.
- **mx_oauth:** protects the Fluxer sign-in against tampering; 10 minutes. HttpOnly.
- **mx_lang:** remembers the language you picked; 1 year.

We use no browser storage besides these cookies.

- **Legal basis:** Section 25(2) no. 2 of the German TDDDG, because storing is strictly necessary for the service you asked for. No consent is needed.

### Dashboard access and votes

Admins of a community can give other members or roles access to modules. We store the role or user ID, the module, the level and who granted it, until the access is removed.

Some modules unlock after a vote for Maxwell on fluxerlist.com. To check this, we send your Fluxer user ID to fluxerlist.com and store that you voted, with the time. Fluxerlist is responsible for its own processing.

### Audit trail

Changes made in the dashboard are recorded with the acting user's ID, the time, the module and the values before and after, so that admins can see who changed what and undo it. Entries are deleted after 12 months.

- **Legal basis:** Art. 6(1)(f) GDPR (traceability of changes).

## 5. What Maxwell processes in communities

Maxwell receives messages and events from the communities it is in, such as message content, user IDs, names, avatars, roles, joins and leaves. Most of it is only looked at and not stored. What is stored depends on the modules the admins turned on:

- **Moderation:** cases with member, moderator, reason, evidence links and an excerpt of up to 1,000 characters from the message a moderator replied to; notes about members; a history of names and nicknames. Cases are deleted after two years by default; admins can choose 90 days, one year or no limit. Name history is deleted after 365 days.
- **Inbox:** reports by members (who reported, the reported member, the message text and link, the reason), ban appeals sent through the appeal form (the appealing user and their text), escalation reviews, and who handled them with outcome and note. Moderators see who reported; the reported member does not. Closed items are deleted 12 months after closing.
- **AutoMod:** if admins turn on message history for dry runs, recent messages with author, roles and content (up to 4,000 characters), at most 100,000 per community; deleted after 7 days, or within an hour after the history is turned off. It is off by default. Hits with the triggering message are deleted after 180 days, test runs after 30 days.
- **Security:** verification checks with a risk score and its reasons (for example account age, avatar, name, joins in a wave, earlier bans), captcha attempts and security events; deleted after 90 days.
- **Logs:** Maxwell keeps up to the last 2,000 messages per community in memory only, so it can show the old text when a message is edited or deleted. Nothing of this is written to our database, and it is gone when the bot restarts. The log entries themselves are posted into a channel of the community and then belong to the community.
- **Invites and joins:** when a member joined or left, which invite they used and who created it; deleted 12 months after the member left.
- **Welcome and roles:** whether a member accepted the rules; roles a member had, so they can be given back on rejoin (deleted 180 days after leaving by default); temporary roles until they run out.
- **Levels, economy, collection and games:** XP, balances, transactions, purchases, inventory, cards, trades, scores and activity counts. Activity counts for the collection are deleted after 400 days.
- **Tickets and modmail:** tickets with opener, members, subject and rating, and, if transcripts are on (the default), every message in the ticket with author, name, avatar link, content, attachment names and links and edits. Closed tickets are deleted with their transcript 12 months after closing. When someone sends Maxwell a direct message, we store the DM channel so replies can reach them.
- **Forms, suggestions, events, polls and giveaways:** answers, suggestions, votes, sign-ups, entries and winners.
- **Starboard:** the author and content of starred messages.
- **Scheduler:** reminders with their text until they are delivered or removed.
- **Insights:** message counts per channel and hour and per member and day, joins and leaves, voice time per channel and moderation actions per moderator. Deleted after 365 days by default (admins can choose 30 to 730).
- **Backups:** the structure of the community (roles, channels, permissions) and who made a snapshot. Daily snapshots are deleted after 14 days by default (1 to 90).
- **Cards:** background pictures that admins upload or link. Maxwell downloads linked pictures once and stores them as JPEG. Avatars are drawn onto cards and kept in memory only.
- **Custom commands, voice rooms and feeds:** who last used a command, owners and members of voice rooms while the room exists. Feeds store no personal data.

Where no period is given above, data is kept as long as the community uses Maxwell and the admins do not delete it.

- **Purpose:** running the modules the admins of a community turned on.
- **Legal basis:** Art. 6(1)(f) GDPR. The legitimate interest is that of the community and of us: moderating the community, protecting it against spam and raids, and running the features its members use.

**For members of communities:** the admins of a community decide what Maxwell does there. You can also turn to them, and to us at [rainer@schnittert.com](mailto:rainer@schnittert.com).

## 6. Who sees the data

- **Admins and moderators of a community** see the data of their community in the dashboard and in Fluxer, for example cases, notes, member files, transcripts and logs, depending on the access they were given.
- **Members** see what Maxwell posts in channels, such as level cards, leaderboards and the starboard.
- **We** can see all data where needed for operation and troubleshooting. The bot owner account can open the dashboard of every community Maxwell is in.

## 7. Requests to other services

Maxwell fetches data from other services when admins set it up:

- **Feeds:** Reddit, GitHub, YouTube, Twitch, Bluesky, the Fluxer blog and RSS addresses entered by admins. These services see the IP address of our servers, not that of members.
- **Pictures:** HTTPS addresses that admins enter for card backgrounds, and pictures in starred messages.
- **Discord:** when admins import a Discord server template, Maxwell loads it from discord.com.
- **fluxerlist.com:** vote checks (section 4).

## 8. Logs

The bot writes technical logs with community, channel, role and ticket IDs and error messages, in rare cases a user ID. It writes no message content and no IP addresses. The dashboard writes no logs of its own.

- **Purpose:** troubleshooting. **Legal basis:** Art. 6(1)(f) GDPR.
- **Retention:** the logs are kept by our hosting provider's server cluster. They are rotated by size and deleted when the component that wrote them is replaced, for example on an update.

## 9. Export and deletion

- **m!mydata** sends you a JSON file by direct message with what Maxwell stores about you in that community.
- **m!forgetme confirm** deletes your data in that community: levels, balances, notes, name history, AutoMod and security records, form answers, votes and the other module data. Your name is removed from reports you made, and closed appeals are deleted. Some things stay, because the community needs them or they involve other people: moderation cases about you; messages in closed tickets (your name and ID are removed from the ticket); open tickets, pending form answers and pending security checks until they are handled. The request itself is recorded in the audit trail with your user ID.
- For anything else, an email to [rainer@schnittert.com](mailto:rainer@schnittert.com) is enough.

When Maxwell is removed from a community, all data of that community is deleted after 30 days. If Maxwell is added again before that, everything is still there.

## 10. Backups

Every night we back up the complete database. Before the backup is written, it is encrypted with a key whose counterpart for decryption only we hold, offline. The backups are stored in the same server cluster and kept for 14 days. Deleted data therefore remains in backups for up to 14 days. We only use them to restore data after an error or outage.

- **Legal basis:** Art. 6(1)(f) GDPR (protection against data loss) and Art. 32 GDPR.

## 11. Recipients

- **FluxerHost (Northwest Intelligence Solutions LLC), USA:** runs the server cluster with the database and logs. Processor.
- **Email hosting in Switzerland:** hosts our email, including messages you send us. Processor.
- **Fluxer Platform AB, Sweden:** runs Fluxer and the sign-in, delivers everything Maxwell sends and serves pictures. Fluxer is responsible for this itself; [Fluxer's privacy policy](https://fluxer.app/privacy) applies.
- **fluxerlist.com** for vote checks, and the services in section 7.
- **Admins, moderators and members of communities** as described in section 6.
- **Authorities and courts,** where we are legally required.

## 12. Transfers outside the EU

Because Maxwell is hosted in the USA, we transfer the data described here to the USA, a country outside the EU.

- **FluxerHost (Northwest Intelligence Solutions LLC)** is not certified under the EU-U.S. Data Privacy Framework. The transfer is based on the European Commission's standard contractual clauses (Implementing Decision (EU) 2021/914) under Art. 46(2)(c) GDPR.
- **Email hosting in Switzerland:** the European Commission has decided that Switzerland ensures an adequate level of data protection (Decision 2000/518/EC, Art. 45 GDPR).

The USA does not offer a level of data protection equivalent to the EU's in every respect. In particular, US authorities may be able to access data without you learning about it or being able to challenge it effectively. You can get a copy of the standard contractual clauses by email.

## 13. Your rights

You have the right to access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18) and data portability (Art. 20).

You can lodge a complaint with a data protection supervisory authority (Art. 77 GDPR), for example in the EU country where you live. The authority responsible for us is the Bavarian Data Protection Authority (Bayerisches Landesamt für Datenschutzaufsicht), Promenade 18, 91522 Ansbach, Germany, [www.lda.bayern.de](https://www.lda.bayern.de).

## 14. Right to object

**Where we process your data based on legitimate interests (Art. 6(1)(f) GDPR), you can object at any time on grounds relating to your particular situation (Art. 21 GDPR). We then stop the processing unless we can demonstrate compelling legitimate grounds that override your interests, rights and freedoms, or the processing serves the establishment, exercise or defense of legal claims. An email to [rainer@schnittert.com](mailto:rainer@schnittert.com) is enough.**

## 15. Security

Connections are encrypted, Fluxer tokens are encrypted on top, sessions are stored only as hashes, and backups are encrypted. Only a few people have access to the servers. In the event of a data breach we will notify the supervisory authority and, where required, you (Art. 33 and 34 GDPR).

## 16. Changes

We update this privacy policy when Maxwell or the law changes. The current version is always available at [/privacy](/privacy).
`;
