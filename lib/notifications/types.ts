// types.ts
export interface TeamsMessageParams {
  teamsId: string;
  channelId: string;
}

export interface EmailMessageParams {
  to: string | string[];
  subject: string;
}

export interface MessageOptions {
  message: string;
  teams?: TeamsMessageParams;
  email?: EmailMessageParams;
}