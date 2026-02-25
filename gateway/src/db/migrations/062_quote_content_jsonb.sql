-- Consolidate all editable document text blocks into a single content JSONB column
-- on both quotes and quote_templates, replacing scattered text columns and terms JSONB.

-- ─── Add content JSONB to quotes ───

ALTER TABLE quotes ADD COLUMN content JSONB DEFAULT '{}'::jsonb;

-- ─── Add content JSONB to quote_templates ───

ALTER TABLE quote_templates ADD COLUMN content JSONB DEFAULT '{}'::jsonb;

-- ─── Migrate existing quotes data into content ───

UPDATE quotes SET content = jsonb_strip_nulls(jsonb_build_object(
  'intro',                COALESCE(intro_text, ''),
  'closing',              COALESCE(closing_text, ''),
  'terms_conditions',     COALESCE(terms->>'conditions', ''),
  'terms_delivery',       COALESCE(terms->>'delivery', ''),
  'terms_payment',        COALESCE(terms->>'payment', ''),
  'terms_contract_duration', COALESCE(terms->>'contract_duration', ''),
  'terms_acceptance',     COALESCE(terms->>'acceptance', '')
))
WHERE intro_text IS NOT NULL
   OR closing_text IS NOT NULL
   OR terms != '{}'::jsonb;

-- ─── Migrate existing quote_templates data into content ───

UPDATE quote_templates SET content = jsonb_strip_nulls(jsonb_build_object(
  'intro',                COALESCE(intro_text, ''),
  'closing',              COALESCE(closing_text, ''),
  'terms_conditions',     COALESCE(terms->>'conditions', ''),
  'terms_delivery',       COALESCE(terms->>'delivery', ''),
  'terms_payment',        COALESCE(terms->>'payment', ''),
  'terms_contract_duration', COALESCE(terms->>'contract_duration', ''),
  'terms_acceptance',     COALESCE(terms->>'acceptance', ''),
  'show_acceptance_signature', to_jsonb(COALESCE(show_acceptance, true)),
  'show_customer_form',   to_jsonb(COALESCE(show_customer_form, false)),
  'show_sepa',            to_jsonb(COALESCE(show_sepa, false))
))
WHERE intro_text IS NOT NULL
   OR closing_text IS NOT NULL
   OR terms != '{}'::jsonb;

-- ─── Update seeded "Sprach-KI Cloud Standard" template with full content ───

UPDATE quote_templates SET content = '{
  "salutation": "Sehr geehrte Damen und Herren!",
  "intro": "Vielen Dank für Ihr Interesse an unseren Sprach-KI Lösungen. Gerne unterbreiten wir Ihnen ein Angebot für das Aufsetzen und den Betrieb unserer SPRACH-KI Lösung:",
  "service_description": "Betrieb des SPRACH-KI Agenten auf modernster Server Architektur.",
  "closing": "Wir sind überzeugt, Ihnen mit diesem Angebot eine qualitativ hochwertige und zukunftssichere Lösung anzubieten. Bei Fragen oder für weitere Informationen stehen wir Ihnen selbstverständlich jederzeit gerne zur Verfügung.",
  "greeting": "Mit freundlichen Grüßen,",
  "items_summary_label": "SUMME MONATLICH NETTO",
  "terms_conditions": "Dieses Angebot gilt vorbehaltlich technischer Realisierbarkeit. Von diesem Angebot ausgenommen sind alle Leistungen und Kosten, die im Angebot nicht ausgewiesen sind und für deren Verrechnung es keine explizite schriftliche Vereinbarung gibt.",
  "terms_delivery": "Nach Auftragserteilung innerhalb von 14 Tagen.",
  "terms_payment": "Laufende Gebühren werden im Vorhinein verrechnet. Overage Gebühren werden im Nachhinein verrechnet. Sekundengenaue Abrechnung ab der ersten Sekunde. Ein Upgrade Ihres Pakets ist jederzeit möglich. Bitte beachten Sie, dass nicht verbrauchte Minuten am Ende des Abrechnungszeitraums nicht ins nächste Monat übertragen werden. Alle Preisangaben in Euro Netto exklusive gesetzlicher Mehrwertsteuer. Alle nicht schriftlich vereinbarten Aufwände werden nach Abnahme, Fertigstellung, Zusenden von Login-Daten oder Leistungsbeginn abgerechnet.",
  "terms_contract_duration": "Der Vertrag ist monatlich zum Stichtag kündbar, sodass Sie stets flexibel bleiben.",
  "terms_acceptance": "Hiermit bestelle ich die im Angebot ausgewiesenen Leistungen. Ich habe die AGB gelesen, verstanden und akzeptiert und kann diese unter https://itellico.ai/de/rechtliches/agb abrufen.\nFür nicht vereinbarte Leistungen gelten die itellico Verrechnungssätze abrufbar unter https://itellico.ai/de/rechtliches/verrechnungssaetze/\nUnser Auftragsverarbeitungsvertrag abrufbar unter https://itellico.ai/de/rechtliches/auftragsverarbeitungsvertrag/ ist integrierter Bestanteil des Vertrags",
  "show_acceptance_signature": true,
  "show_customer_form": true,
  "show_sepa": true,
  "sepa_text": "Hiermit ermächtige ich die itellico internet solutions gmbh widerruflich, die von mir zu entrichtenden Zahlungen bei Fälligkeit zu Lasten meines Kontos mittels Einzugsermächtigungsverfahren einzuziehen. Damit ist auch meine kontoführende Bank ermächtigt, die Lastschriften einzulösen. Meine Bank ist aber keinesfalls, so z.B. auch nicht bei mangelnder Deckung des Kontos, zur Einlösung verpflichtet. Ich habe das Recht, innerhalb von 56 Kalendertagen ab Abbuchungsauftrag ohne Angabe von Gründen die Rückbuchung bei meiner Bank zu veranlassen."
}'::jsonb
WHERE name = 'Sprach-KI Cloud Standard';
