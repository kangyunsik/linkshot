# 팀 전장 콘셉트 원본

현재 게임은 `public/assets/maps/*.svg`의 실제 지형 썸네일을 사용합니다.
사용하지 않는 아래 콘셉트 4장은 출처·프롬프트와 함께 이 문서 폴더로 옮겨,
약 8.5 MiB를 브라우저·Windows 배포에서 제외했습니다. 이미지 자체는 변경하지 않았습니다.

- [FAULTLINE](faultline-hero.png)
- [SUMP](sump-hero.png)
- [RELAY](relay-hero.png)
- [BASTION](bastion-hero.png)

생성 정보는 `asset-manifest.json`에 보존합니다.
`npm run assets:generate -- --team-maps`도 콘셉트는 이 폴더에, 런타임 재질만 `public/assets`에 저장합니다.
