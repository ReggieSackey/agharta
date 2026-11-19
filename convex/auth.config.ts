/**
 * WorkOS AuthKit (OIDC) trust for Convex.
 * Per https://docs.convex.dev/auth/authkit — WorkOS AuthKit exposes an OIDC
 * endpoint at https://auth.workos.com and issues tokens with the WorkOS
 * client ID as audience.
 */
export default {
  providers: [
    {
      domain: 'https://auth.workos.com',
      applicationID: process.env.WORKOS_CLIENT_ID ?? '',
    },
  ],
};
