// A fake mail server for the end-to-end run: accepts SMTP on SMTP_PORT and serves every
// message it got as JSON on MAILBOX_PORT, so tests can follow emailed links.
import { createServer } from "node:http";
import { SMTPServer } from "smtp-server";
import { MAILBOX_PORT, SMTP_PORT } from "./env";

interface Mail {
  to: string[];
  raw: string;
}

const mails: Mail[] = [];

new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, done) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw: Buffer.concat(chunks).toString("utf8") });
      done();
    });
  },
}).listen(SMTP_PORT, "127.0.0.1");

createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(mails));
}).listen(MAILBOX_PORT, "127.0.0.1", () => console.info(`mailbox on ${MAILBOX_PORT}`));
