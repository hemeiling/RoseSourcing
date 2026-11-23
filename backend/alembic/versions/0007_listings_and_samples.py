"""listing details on price observations; sample orders

Revision ID: 0007
Revises: 0006
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("price_observations", sa.Column("platform", sa.String(length=48), nullable=True))
    op.add_column("price_observations", sa.Column("rating", sa.Numeric(precision=3, scale=2), nullable=True))
    op.add_column("price_observations", sa.Column("review_count", sa.Integer(), nullable=True))
    op.add_column("price_observations", sa.Column("badges", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False))
    op.create_table(
        "sample_orders",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("variant", sa.Text(), nullable=True),
        sa.Column("unit_cost", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("shipping_cost", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("ordered_on", sa.Date(), nullable=True),
        sa.Column("received_on", sa.Date(), nullable=True),
        sa.Column("tracking", sa.Text(), nullable=True),
        sa.Column("scores", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["business_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sample_orders_project_id", "sample_orders", ["project_id"])
    op.create_index("ix_sample_orders_supplier_id", "sample_orders", ["supplier_id"])


def downgrade() -> None:
    op.drop_index("ix_sample_orders_supplier_id", table_name="sample_orders")
    op.drop_index("ix_sample_orders_project_id", table_name="sample_orders")
    op.drop_table("sample_orders")
    for col in ("badges", "review_count", "rating", "platform"):
        op.drop_column("price_observations", col)
