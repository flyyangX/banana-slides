"""Add page_type to pages and template_variants to projects

Revision ID: 012_add_page_type_and_template_variants
Revises: 011_add_user_template_thumb
Create Date: 2026-01-21
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '012_add_page_type_and_template_variants'
down_revision = '011_add_user_template_thumb'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('pages', sa.Column('page_type', sa.String(length=20), nullable=True, server_default='auto'))
    op.add_column('projects', sa.Column('template_variants', sa.Text(), nullable=True))
    op.execute("UPDATE pages SET page_type = 'auto' WHERE page_type IS NULL")


def downgrade():
    op.drop_column('projects', 'template_variants')
    op.drop_column('pages', 'page_type')
