"""supplier quote source url

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("supplier_quotes", sa.Column("source_url", sa.Text(), nullable=True))
    # Listing quotes saved before this column existed carry their link in the notes ("... Source: <url>").
    op.execute("UPDATE supplier_quotes SET source_url = substring(notes from 'Source: (https?://[^ ]+)') "
               "WHERE source = 'research_listing' AND notes LIKE '%Source: http%'")


def downgrade() -> None:
    op.drop_column("supplier_quotes", "source_url")
