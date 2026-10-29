// k6 load test: seeds links, then hammers the redirect path.
//   k6 run loadtest/redirect.js   (BASE_URL and API_KEY are optional env vars)

import { check } from "k6";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const HEADERS = { "Content-Type": "application/json", ...(__ENV.API_KEY && { "x-api-key": __ENV.API_KEY }) };

export const options = {
  scenarios: {
    redirects: {
      executor: "constant-arrival-rate",
      rate: 1500,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<50"],
    http_req_failed: ["rate<0.001"],
  },
};

export function setup() {
  const codes = [];
  for (let i = 0; i < 200; i++) {
    const res = http.post(
      `${BASE_URL}/api/v1/links`,
      JSON.stringify({ url: `https://example.com/page/${i}-${Date.now()}` }),
      { headers: HEADERS },
    );
    codes.push(res.json("code"));
  }
  return { codes };
}

export default function (data) {
  const code = data.codes[Math.floor(Math.random() * data.codes.length)];
  const res = http.get(`${BASE_URL}/${code}`, { redirects: 0 });
  check(res, { "is 302": (r) => r.status === 302 });
}
