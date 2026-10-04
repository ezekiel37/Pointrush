# Ingress and client identity

Reviewed 1 October 2026. This is a deployment decision record and verification plan, not a claim that Cloudflare or Cloud Run has been configured.

## Current boundary

Express explicitly disables proxy trust. Authentication overwrites the internal client-IP header with the TCP peer address before Better Auth processes the request. If the peer address is missing or invalid, authentication returns a sanitized 503 instead of continuing without an IP rate-limit key. No forwarding header or browser cookie proves that a request came through a trusted proxy.

This protects against header spoofing, but does not recover visitor IPs behind Cloud Run. Many visitors may share a proxy address and rate-limit bucket. Public launch is blocked on verifying the actual ingress chain and choosing its client-IP policy. Increasing limits or trusting arbitrary headers would hide the problem. IP limits also cannot distinguish all legitimate users behind mobile-carrier NAT; retain recipient quotas and add account/action controls as product features arrive.

## Deployment choices

| Path                                    | Required decision                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser to Cloud Run directly           | Verify platform-added forwarding data and every reachable endpoint before selecting trusted address extraction. Cloudflare DNS alone does not put its WAF/CDN in this request path. |
| Browser through Cloudflare to Cloud Run | Prove origin authentication and header replacement on the chosen hostname; direct origin access must not bypass the policy. Do not read CF-Connecting-IP merely because it exists.  |
| Scheduler to email worker               | Separate service with Cloud Run invoker IAM and the existing application secret. Evaluate internal ingress with a same-project scheduler. Keep the worker off browser routes.       |
| Later VPS                               | Restrict origin access to the selected proxy and configure explicit trusted peers. Revalidate after changing topology.                                                              |

Cloud Run exposes default URLs, domain mappings and load-balancer paths. Its ingress restrictions apply across those paths, and IAM remains separate. The internal-and-cloud-load-balancing setting refers to Google's load balancer, not an arbitrary external CDN. Disabling the default URL can also affect callers that depend on it. Inventory paths before changing settings. [Google ingress documentation](https://docs.cloud.google.com/run/docs/securing/ingress).

Cloudflare documents origin authentication using mechanisms including authenticated origin pulls or an HTTP authentication header. AOP needs origin-side TLS client-certificate validation; do not assume an application container behind managed TLS termination can enforce it. An edge-injected secret is only a candidate here: establish availability, secure storage, replacement of caller-supplied values and rotation before implementation. It does not prevent direct requests from reaching billable compute. [Origin protection](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/) and [visitor headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

Do not add a load balancer, Worker or tunnel simply to make the diagram complete. Compare the concrete origin-security requirement and operating cost when deployment details are known.

## Required staging evidence

1. List API and worker URLs, domain mappings, preview/tag endpoints, ingress settings and IAM invokers. Use synthetic accounts.
2. Test from two independent networks. Confirm expected visitor separation, including IPv6, without exposing a public diagnostic endpoint or recording raw credentials.
3. Send forged X-Forwarded-For chains, Forwarded, CF-Connecting-IP, True-Client-IP and the internal Acticlaim header. Vary addresses and duplicate headers. Rate limits must not reset because of caller-controlled input.
4. Repeat through the intended hostname and directly against every origin path. Either reject bypasses or apply an independently verified identity policy to them.
5. Verify host/protocol spoofing cannot alter auth redirects, cookie security or allowed origins. Keep AUTH_BASE_URL explicit and test real browser cookies on the production domain arrangement.
6. Verify unauthorized worker invocation is denied before provider work. Exercise valid scheduler calls, overlap, timeout recovery and stable provider idempotency keys. Do not disable worker URLs needed by the scheduler without a replacement path.

Express warns that blanket trust and fixed hop counts can accept forged values when paths differ. Trust must match the deployed topology, including header sanitization. Keep its default disabled until the above evidence supports a narrower policy. [Express proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

Local regression tests cover forged session-IP headers, rotating-header rate-limit attempts and missing transport identity. They do not validate Google's or Cloudflare's deployed behavior. No new environment variables, dependencies, paid services or deployment resources are introduced by this slice.
