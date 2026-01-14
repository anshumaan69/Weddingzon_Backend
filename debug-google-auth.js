const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Token from the logs
const idToken = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjdiZjU5NTQ4OWEwYmIxNThiMDg1ZTIzZTdiNTJiZjk4OTFlMDQ1MzgiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiIyOTQxMDgyNTM1NzItOTBxbmhpbWNqZjhudWdwZGZxbjNtMGYxbTluaThxMnAuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhenAiOiIyOTQxMDgyNTM1NzItb2loODByYmowMHQ4cnJudGppbmNhdTdoaTZjYmppNGYuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMTQ4NzI3ODQ2NjEwODQ2MjUwNDIiLCJlbWFpbCI6ImFiaGlqZWV0ZDA0MDlAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJBYmhpamVldCBEdWJleSIsInBpY3R1cmUiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NKeU5oLW5MaVlYUDNRRHZDUV83RlZYMzNYUWFvTFFqQ0R6ZmZEYm9xU1pmenN0YktBPXM5Ni1jIiwiZ2l2ZW5fbmFtZSI6IkFiaGlqZWV0IiwiZmFtaWx5X25hbWUiOiJEdWJleSIsImlhdCI6MTc2ODQyMzg0MywiZXhwIjoxNzY4NDI3NDQzfQ.KP8-1kc1K4leVZIHZNuVGTakq4RPyQAhm7eISmLBe0n4u8wrdw33Cp6Z_rLqGX9cc7ddBuhIX8zM22pjb4HrQtHqSVyFkLjTDjfuF4NLNZgZT6VOezQxRQ135-RcRjotZoRpRZXc7rt8koBdgxXfJtq6F75WoTqKvWp0jtActzHC9GvPwHFWdde8B_FwadbCvs7_z2ss9jk5AeHYpKCPTSq1Pl4FhBvbxw--W-YZqGzvFm54-OrlnxAr7QHCqp-KLol76fnLTDovjB4_Q_CJviG3vkn5NiPLr2aEhKqF6FyF2wr_7o4_vdWE-oWYhmYF7Y380hUD4IonTnNFSEBbDg";

async function verify() {
    try {
        console.log('Verifying token...');
        // Add the flutter client ID to trusted audiences
        const FLUTTER_CLIENT_ID = '294108253572-oih80rbj00t8rrntjincau7hi6cbji4f.apps.googleusercontent.com';
        const validAudiences = [process.env.GOOGLE_CLIENT_ID, FLUTTER_CLIENT_ID];

        console.log('Valid Audiences:', validAudiences);

        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: validAudiences,
        });
        const payload = ticket.getPayload();
        console.log('Success! Payload:', payload);
    } catch (error) {
        console.error('Error verifying token:', error);
        console.error('Full Error:', JSON.stringify(error, null, 2));
    }
}

verify();
