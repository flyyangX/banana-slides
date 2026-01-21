"""Add display_name and note to materials

Revision ID: 014_add_material_display_name_note
Revises: 013_add_template_sets_and_active_key
Create Date: 2026-01-22
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '014_add_material_display_name_note'
down_revision = '013_add_template_sets_and_active_key'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('materials', sa.Column('display_name', sa.String(length=255), nullable=True))
    op.add_column('materials', sa.Column('note', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('materials', 'note')
    op.drop_column('materials', 'display_name')
