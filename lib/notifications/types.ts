// types.ts
export interface TeamsMessageParams {
    teamsId?: string;
    channelId?: string;
}

export interface EmailMessageParams {
    to: string | string[];
    subject: string;
}

export type MessageOptions = {
    message: string;
} & (
    | { teams: TeamsMessageParams; email?: never }
    | { email: EmailMessageParams; teams?: never }
    | { teams: TeamsMessageParams; email: EmailMessageParams }
);
