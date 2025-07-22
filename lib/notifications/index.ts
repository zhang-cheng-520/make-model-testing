// /lib/notifications/index.ts
import { TeamsMessenger } from "./teamsMessenger";
import { MessageOptions } from "./types";

const teamsMessenger = new TeamsMessenger();

export const NotificationService = {
  async send(options: MessageOptions) {
    if (options.teams) {
      await this.sendTeamsMessage(options);
    }
    // if (options.email) {
    //   await this.sendEmail(options);
    // }
  },

  async sendTeamsMessage(options: MessageOptions) {
    const teamsId = options.teams?.teamsId ?? process.env.DEFAULT_TEAMS_ID!;
    const channelId = options.teams?.channelId ?? process.env.DEFAULT_CHANNEL_ID!;
    console.log(teamsId)
    console.log(channelId)
    console.log("Test")
    if (!teamsId || !channelId) {
      throw new Error("Missing teamsId or channelId and no default is set");
    }

    return teamsMessenger.send({ 
      teams: { teamsId, channelId }, 
      message: options.message 
    });
  },

};