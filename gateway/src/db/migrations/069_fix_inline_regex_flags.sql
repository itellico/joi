-- Fix (?i) inline regex flags in expected_content_patterns
-- JavaScript's RegExp doesn't support inline flags; the evaluator already uses "i" flag

UPDATE qa_test_cases
SET turns = replace(turns::text, '(?i)', '')::jsonb
WHERE turns::text LIKE '%(?i)%';
