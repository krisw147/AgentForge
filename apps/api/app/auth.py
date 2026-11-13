from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from fastapi import Cookie, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AuthSession, Membership, Tenant, User


SESSION_COOKIE = "agentforge_session"
SESSION_HOURS = 12
PASSWORD_ITERATIONS = 210_000


@dataclass
class AuthContext:
    session: AuthSession
    user: User
    tenant: Tenant
    role: str


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PASSWORD_ITERATIONS}$"
        f"{salt.hex()}${digest.hex()}"
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_memberships(
    db: Session, user_id: str
) -> List[Tuple[Membership, Tenant]]:
    return (
        db.query(Membership, Tenant)
        .join(Tenant, Tenant.id == Membership.tenant_id)
        .filter(Membership.user_id == user_id)
        .order_by(Membership.created_at)
        .all()
    )


def create_session(
    db: Session,
    user: User,
    tenant_id: str,
    user_agent: str = "",
) -> Tuple[AuthSession, str]:
    raw_token = secrets.token_urlsafe(32)
    session = AuthSession(
        id=str(uuid.uuid4()),
        user_id=user.id,
        tenant_id=tenant_id,
        token_hash=hash_session_token(raw_token),
        expires_at=datetime.utcnow() + timedelta(hours=SESSION_HOURS),
        user_agent=user_agent[:300],
    )
    db.add(session)
    db.commit()
    return session, raw_token


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def get_auth_context(
    session_token: Optional[str] = Cookie(
        default=None, alias=SESSION_COOKIE
    ),
    db: Session = Depends(get_db),
) -> AuthContext:
    if not session_token:
        raise HTTPException(status_code=401, detail="请先登录")
    session = (
        db.query(AuthSession)
        .filter(
            AuthSession.token_hash == hash_session_token(session_token),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=401, detail="登录状态已失效")
    user = db.query(User).filter(User.id == session.user_id).first()
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == session.user_id,
            Membership.tenant_id == session.tenant_id,
        )
        .first()
    )
    tenant = (
        db.query(Tenant).filter(Tenant.id == session.tenant_id).first()
    )
    if not user or not membership or not tenant:
        raise HTTPException(status_code=401, detail="工作区访问权限已失效")
    session.last_seen_at = datetime.utcnow()
    db.commit()
    return AuthContext(
        session=session,
        user=user,
        tenant=tenant,
        role=membership.role,
    )


def require_roles(*allowed_roles: str):
    allowed = set(allowed_roles)

    def dependency(
        auth: AuthContext = Depends(get_auth_context),
    ) -> AuthContext:
        if auth.role not in allowed:
            raise HTTPException(status_code=403, detail="当前角色没有此操作权限")
        return auth

    return dependency


def serialize_auth(auth: AuthContext, db: Session) -> dict:
    memberships = user_memberships(db, auth.user.id)
    return {
        "user": {
            "id": auth.user.id,
            "name": auth.user.name,
            "email": auth.user.email,
        },
        "activeTenant": {
            "id": auth.tenant.id,
            "name": auth.tenant.name,
            "slug": auth.tenant.slug,
            "role": auth.role,
        },
        "workspaces": [
            {
                "id": tenant.id,
                "name": tenant.name,
                "slug": tenant.slug,
                "plan": tenant.plan,
                "role": membership.role,
                "active": tenant.id == auth.tenant.id,
            }
            for membership, tenant in memberships
        ],
    }
