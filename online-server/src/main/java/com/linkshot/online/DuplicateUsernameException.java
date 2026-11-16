package com.linkshot.online;

final class DuplicateUsernameException extends IllegalArgumentException {
    DuplicateUsernameException() { super("이미 존재하는 아이디입니다."); }
}
