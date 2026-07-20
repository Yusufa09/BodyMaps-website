"""job table for inference state

Initial migration. Creates `job` (inference-job state) plus the pre-existing
`application_session` / `combined_labels` models, so the history matches the
full ModelBase metadata and future autogenerate starts from a clean diff.

Revision ID: 17c9584d5677
Revises:
Create Date: 2026-07-20 16:05:31.775823

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '17c9584d5677'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('application_session',
    sa.Column('session_id', sa.String(), nullable=False),
    sa.Column('main_nifti_path', sa.String(), nullable=False),
    sa.Column('combined_labels_id', sa.String(), nullable=False),
    sa.Column('session_created', sa.DateTime(), nullable=False),
    sa.Column('session_expire_date', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('session_id'),
    sa.UniqueConstraint('combined_labels_id'),
    sa.UniqueConstraint('session_id')
    )
    op.create_table('combined_labels',
    sa.Column('combined_labels_id', sa.String(), nullable=False),
    sa.Column('combined_labels_path', sa.String(), nullable=False),
    sa.Column('organ_intensities', sa.JSON(), nullable=False),
    sa.Column('organ_metadata', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('combined_labels_id')
    )
    op.create_table('job',
    sa.Column('session_id', sa.String(length=128), nullable=False),
    sa.Column('model', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('ct_path', sa.Text(), nullable=True),
    sa.Column('session_path', sa.Text(), nullable=True),
    sa.Column('zip_path', sa.Text(), nullable=True),
    sa.Column('output_mask_dir', sa.Text(), nullable=True),
    sa.Column('lease_owner', sa.String(length=128), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('cancel_requested', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('session_id')
    )
    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.create_index('ix_job_status_created_at', ['status', 'created_at'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('job', schema=None) as batch_op:
        batch_op.drop_index('ix_job_status_created_at')

    op.drop_table('job')
    op.drop_table('combined_labels')
    op.drop_table('application_session')
