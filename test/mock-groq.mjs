// Dev-only preload for browser testing without a Groq key:
//   GROQ_API_KEY=fake node --import ./test/mock-groq.mjs dev-server.js
// Replaces fetch calls to api.groq.com with canned replies.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes("api.groq.com")) return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  const last = body.messages.at(-1).content;
  await new Promise((r) => setTimeout(r, 1200));
  if (/fail/i.test(last)) {
    return new Response(JSON.stringify({ error: { message: "mock failure" } }), { status: 500 });
  }
  const content = `**Mock reply** to: ${last}\n\nI received ${body.messages.length - 1} conversation messages using model \`${body.model}\`.\n\n- point one\n- point two\n\n\`\`\`js\nconsole.log("hi");\n\`\`\``;
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
};
