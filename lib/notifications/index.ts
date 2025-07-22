import { TeamsMessenger } from "./teamsMessenger";
import { MessageOptions } from "./types";

const teamsMessenger = new TeamsMessenger();

export const NotificationService = {
  async sendTeamsMessage(options: MessageOptions) {
  const teamsId = options.teams?.teamsId ?? process.env.DEFAULT_TEAMS_ID!; // default to Ecics Dial -> Test channel if usr doesnt specify
  const channelId = options.teams?.channelId ?? process.env.DEFAULT_CHANNEL_ID!;

  if (!teamsId || !channelId) {
    throw new Error("Missing teamsId or channelId and no default is set");
  }

  return teamsMessenger.send({ teams: { teamsId, channelId }, message: options.message });
}
,

  // Email implementation
  // async sendEmail(options: MessageOptions) {
  //   if (!options.email?.to || !options.email?.subject) {
  //     throw new Error("Email requires 'to' and 'subject'");
  //   }
  //   return emailMessenger.send({
  //     to: options.email.to,
  //     subject: options.email.subject,
  //     text: options.message,
  //   });
  // },

  async send(options: MessageOptions) {
    if (options.teams) await this.sendTeamsMessage(options);
    // if (options.email) await this.sendEmail(options);
  },
};
