ALTER TABLE online_matches ADD COLUMN acceptance_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE online_matches ADD COLUMN acceptance_deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE online_matches ADD COLUMN acceptance_closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE online_matches ADD CONSTRAINT match_acceptance_window CHECK (
    NOT acceptance_required OR acceptance_deadline IS NOT NULL
);
CREATE TABLE match_acceptances (
    match_id UUID NOT NULL REFERENCES online_matches(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    decision VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
    responded_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (match_id, account_id)
);
CREATE INDEX open_match_offers ON online_matches(acceptance_deadline)
    WHERE acceptance_required AND acceptance_closed_at IS NULL AND status = 'PENDING';
