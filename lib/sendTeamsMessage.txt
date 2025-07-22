// import axios from "axios";
// import { getRefreshToken, saveRefreshToken } from "./tokenManager";

// const {
//     CLIENT_ID,
//     CLIENT_SECRET,
//     TENANT_ID,
//     TEAMS_ID,
//     CHANNEL_ID,
//     REDIRECT_URI,
// } = process.env;

// const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
// const GRAPH_URL = `https://graph.microsoft.com/v1.0/teams/${TEAMS_ID}/channels/${CHANNEL_ID}/messages`;
// const SCOPE = `ChannelMessage.Send Chat.ReadWrite offline_access openid profile`;

// export async function sendTeamsMessage(message: string): Promise<void> {
//     const refreshToken = getRefreshToken();
//     console.log("Attempting token refresh using refresh_token:", refreshToken);

//     let tokenRes;
//     // redirect_uri must matched the configured on microsoft graph, else it wont return the new refresh token
//     try {
//         tokenRes = await axios.post(
//             TOKEN_URL,
//             new URLSearchParams({
//                 client_id: CLIENT_ID!,
//                 client_secret: CLIENT_SECRET!,
//                 grant_type: "refresh_token",
//                 refresh_token: refreshToken,
//                 redirect_uri: REDIRECT_URI!,
//                 scope: SCOPE,
//             }),
//             {
//                 headers: {
//                     "Content-Type": "application/x-www-form-urlencoded",
//                 },
//             }
//         );
//     } catch (err: any) {
//         console.error(
//             "Token refresh error:",
//             err.response?.data || err.message
//         );
//         throw new Error("Token refresh failed");
//     }

//     const { access_token, refresh_token: newRefresh } = tokenRes.data;

//     if (newRefresh && newRefresh !== refreshToken) {
//         saveRefreshToken(newRefresh);
//     }

//     await axios.post(
//         GRAPH_URL,
//         { body: { content: message } },
//         { headers: { Authorization: `Bearer ${access_token}` } }
//     );
// }
