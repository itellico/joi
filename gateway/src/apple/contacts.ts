// Apple Contacts client — reads from macOS Contacts.app via JXA (osascript)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface Contact {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
  note: string | null;
  birthday: string | null;
  phones: Array<{ label: string; value: string }>;
  emails: Array<{ label: string; value: string }>;
  addresses: Array<{ label: string; street: string; city: string; zip: string; country: string; state: string }>;
  urls: Array<{ label: string; value: string }>;
  socialProfiles: Array<{ serviceName: string; userName: string; url: string }>;
}

function cleanLabel(label: string): string {
  // Apple uses _$!<Home>!$_ format internally
  return label.replace(/^_\$!</, "").replace(/>!\$_$/, "").toLowerCase();
}

function cleanContact(raw: any): Contact {
  return {
    ...raw,
    phones: (raw.phones || []).map((p: any) => ({ ...p, label: cleanLabel(p.label || "") })),
    emails: (raw.emails || []).map((e: any) => ({ ...e, label: cleanLabel(e.label || "") })),
    addresses: (raw.addresses || []).map((a: any) => ({ ...a, label: cleanLabel(a.label || "") })),
    urls: (raw.urls || []).map((u: any) => ({ ...u, label: cleanLabel(u.label || "") })),
  };
}

async function runJxa(script: string, timeout = 30000): Promise<any> {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
    timeout,
  });
  return JSON.parse(stdout.trim());
}

const CONTACT_FIELDS = `{
  id: p.id(),
  name: p.name(),
  firstName: p.firstName(),
  lastName: p.lastName(),
  organization: p.organization(),
  jobTitle: p.jobTitle(),
  note: p.note(),
  birthday: p.birthDate() ? p.birthDate().toISOString() : null,
  phones: p.phones().map(function(ph) { return { label: ph.label(), value: ph.value() }; }),
  emails: p.emails().map(function(e) { return { label: e.label(), value: e.value() }; }),
  addresses: p.addresses().map(function(a) { return { label: a.label(), street: a.street(), city: a.city(), zip: a.zip(), country: a.country(), state: a.state() }; }),
  urls: p.urls().map(function(u) { return { label: u.label(), value: u.value() }; }),
  socialProfiles: p.socialProfiles().map(function(s) { return { serviceName: s.serviceName(), userName: s.userName(), url: s.url() }; })
}`;

export async function searchContacts(searchTerm: string): Promise<Contact[]> {
  const escaped = searchTerm.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  // Use Apple's native .whose() predicates for name/org (indexed and fast).
  // For email/phone, use bulk property access to scan without per-contact bridge calls.
  const script = `
    const app = Application("Contacts");
    const term = '${escaped}';
    const termLower = term.toLowerCase();
    var ids = {};
    var results = [];
    function addContact(p) {
      if (results.length >= 20) return;
      var pid = p.id();
      if (ids[pid]) return;
      ids[pid] = true;
      results.push(${CONTACT_FIELDS});
    }
    function addList(list) {
      for (var i = 0; i < list.length && results.length < 20; i++) {
        addContact(list[i]);
      }
    }
    // Fast indexed searches via .whose()
    try { addList(app.people.whose({ name: { _contains: term } })()); } catch(e) {}
    try { addList(app.people.whose({ organization: { _contains: term } })()); } catch(e) {}
    // If we still need more, use bulk property access for email/phone search
    if (results.length < 5) {
      var allEmails = app.people.emails.value();
      var allPhones = app.people.phones.value();
      var allIds = app.people.id();
      var matchIndices = [];
      for (var i = 0; i < allEmails.length && matchIndices.length < 20; i++) {
        if (ids[allIds[i]]) continue;
        var em = allEmails[i];
        for (var j = 0; j < em.length; j++) {
          if (em[j].toLowerCase().indexOf(termLower) !== -1) { matchIndices.push(i); break; }
        }
      }
      for (var i = 0; i < allPhones.length && matchIndices.length < 20; i++) {
        if (ids[allIds[i]]) continue;
        var ph = allPhones[i];
        for (var j = 0; j < ph.length; j++) {
          if (ph[j].indexOf(term) !== -1) { matchIndices.push(i); break; }
        }
      }
      // Fetch full details only for matched indices
      var people = app.people();
      for (var k = 0; k < matchIndices.length && results.length < 20; k++) {
        var p = people[matchIndices[k]];
        addContact(p);
      }
    }
    JSON.stringify(results);
  `;
  const raw = await runJxa(script, 60000);
  return raw.map(cleanContact);
}

export async function getContact(id: string): Promise<Contact | null> {
  const escaped = id.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const script = `
    const app = Application("Contacts");
    const matches = app.people.whose({ id: '${escaped}' })();
    if (matches.length === 0) { JSON.stringify(null); }
    else {
      const p = matches[0];
      JSON.stringify(${CONTACT_FIELDS});
    }
  `;
  const raw = await runJxa(script);
  return raw ? cleanContact(raw) : null;
}

export async function listContacts(limit = 50): Promise<Array<{ id: string; name: string; organization: string | null }>> {
  // Use bulk property access — much faster than iterating individual contacts
  const script = `
    const app = Application("Contacts");
    const names = app.people.name();
    const orgs = app.people.organization();
    const pids = app.people.id();
    var results = [];
    var len = Math.min(names.length, ${limit});
    for (var i = 0; i < len; i++) {
      results.push({ id: pids[i], name: names[i], organization: orgs[i] || null });
    }
    JSON.stringify(results);
  `;
  return runJxa(script);
}

export async function listGroups(): Promise<Array<{ id: string; name: string; count: number }>> {
  const script = `
    const app = Application("Contacts");
    const groups = app.groups();
    JSON.stringify(groups.map(function(g) {
      return { id: g.id(), name: g.name(), count: g.people().length };
    }));
  `;
  return runJxa(script);
}

export async function getGroupMembers(groupName: string, limit = 50): Promise<Contact[]> {
  const escaped = groupName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const script = `
    const app = Application("Contacts");
    const groups = app.groups.whose({ name: '${escaped}' })();
    if (groups.length === 0) { JSON.stringify([]); }
    else {
      const members = groups[0].people();
      JSON.stringify(members.slice(0, ${limit}).map(function(p) { return ${CONTACT_FIELDS}; }));
    }
  `;
  const raw = await runJxa(script);
  return raw.map(cleanContact);
}

export async function getContactCount(): Promise<number> {
  const script = `
    const app = Application("Contacts");
    JSON.stringify(app.people().length);
  `;
  return runJxa(script);
}
