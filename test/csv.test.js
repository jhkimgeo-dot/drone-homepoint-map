import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsv, detectColumns, parseCsv, pointName, readPlaces, toCsv } from '../csv.js';

const bytes = (s) => new TextEncoder().encode(s);

test('따옴표 안의 쉼표·줄바꿈·이스케이프된 따옴표를 읽는다', () => {
  const records = parseCsv('이름,메모\r\n"가게, 본점","첫 줄\n둘째 줄 ""인기"""\r\n\r\n카페,\n');
  assert.deepEqual(records, [
    { line: 1, cells: ['이름', '메모'] },
    { line: 2, cells: ['가게, 본점', '첫 줄\n둘째 줄 "인기"'] },
    { line: 5, cells: ['카페', ''] },
  ]);
});

test('탭으로 구분한 파일도 읽는다', () => {
  assert.deepEqual(parseCsv('이름\t위도\t경도\n집\t37.5\t127.0').map((r) => r.cells), [
    ['이름', '위도', '경도'],
    ['집', '37.5', '127.0'],
  ]);
});

test('UTF-8 BOM을 지우고, UTF-8이 아니면 EUC-KR로 읽는다', () => {
  assert.equal(decodeCsv(bytes('﻿이름')), '이름');
  // "한글" in EUC-KR
  assert.equal(decodeCsv(Uint8Array.from([0xc7, 0xd1, 0xb1, 0xdb])), '한글');
});

test('한글·영문 머리글을 알아본다', () => {
  assert.deepEqual(detectColumns([' 장소명 ', 'Latitude', 'LONGITUDE', '도로명 주소', '색상']), {
    name: 0,
    lat: 1,
    lng: 2,
    address: 3,
    color: 4,
  });
  assert.deepEqual(detectColumns(['name', 'y', 'x']), { name: 0, lat: 1, lng: 2 });
});

test('홈포인트 코드는 맨 뒤 번호와 그 앞 영문만 이름으로 쓴다', () => {
  assert.equal(pointName('A_TA_GH_16'), 'GH_16');
  assert.equal(pointName('C_SA_JE_9'), 'JE_9');
  assert.equal(pointName('A-TA-GH16'), 'GH16');
  assert.equal(pointName('GH_16'), 'GH_16');
  // 코드 형태가 아니면 그대로
  assert.equal(pointName('서울역'), '서울역');
  assert.equal(pointName('Lotte World Tower 2'), 'Lotte World Tower 2');
  assert.equal(pointName('AB_12_34'), 'AB_12_34');
});

test('홈포인트 CSV 형식을 읽는다 (괄호 붙은 주소 머리글, 모르는 열은 무시)', () => {
  const csv = [
    '\uFEFF이름,시군,읍면,작업자,위도,경도,주소(팜맵 필지 기준),소티,완료 소티,카카오맵 길안내',
    'A_TA_GH_16,태안,근흥면,,36.68,126.13,태안 근흥면 신진도리 인근,1,0,"https://map.kakao.com/link/to/A_TA_GH_16,36.68,126.13"',
    'C_SA_JE_17,신안,자은면,SH,34.90,126.06,신안 자은면 송산리 인근,28,0,"https://map.kakao.com/link/to/C_SA_JE_17,34.90,126.06"',
  ].join('\r\n');
  const { places, errors, columns } = readPlaces(bytes(csv));
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ['name', 'lat', 'lng', 'address']);
  assert.deepEqual(
    places.map(({ name, address, lat, lng }) => ({ name, address, lat, lng })),
    [
      { name: 'GH_16', address: '태안 근흥면 신진도리 인근', lat: 36.68, lng: 126.13 },
      { name: 'JE_17', address: '신안 자은면 송산리 인근', lat: 34.9, lng: 126.06 },
    ],
  );
});

test('행을 장소로 바꾸고 잘못된 행은 줄 번호와 함께 건너뛴다', () => {
  const csv = [
    '이름,주소,위도,경도,색상,메모',
    '판교역,경기 성남시,37.3948,127.1112,파랑,출구 1번',
    ',주소만,37.5,127.0,,',
    '좌표없음,,abc,,,',
    '뒤바뀜,,127.0276,37.4979,,',
    '범위밖,,10,200,,',
    '색없음,,37.5665,126.978,보라색아님,',
  ].join('\n');
  const { places, errors, columns } = readPlaces(bytes(csv), { defaultColor: '#30a46c' });

  assert.deepEqual(columns, ['name', 'address', 'lat', 'lng', 'color', 'memo']);
  assert.deepEqual(
    places.map(({ name, lat, lng, color }) => ({ name, lat, lng, color })),
    [
      { name: '판교역', lat: 37.3948, lng: 127.1112, color: '#3e63dd' },
      { name: '뒤바뀜', lat: 37.4979, lng: 127.0276, color: '#30a46c' },
      { name: '색없음', lat: 37.5665, lng: 126.978, color: '#30a46c' },
    ],
  );
  assert.equal(places[0].memo, '출구 1번');
  assert.deepEqual(errors.map((e) => e.line), [3, 4, 6]);
});

test('필수 열이 없으면 무엇이 빠졌는지 알려 준다', () => {
  assert.throws(() => readPlaces(bytes('이름,주소\n집,서울')), /위도, 경도/);
  assert.throws(() => readPlaces(bytes('')), /비어 있습니다/);
});

test('내보낸 CSV를 다시 가져오면 같은 값이 나온다', () => {
  const original = [{ name: '가게 "본점", 2층', address: '서울', phone: '02-123-4567', memo: '줄\n바꿈', lat: 37.5, lng: 127.01, color: '#e93d82' }];
  const { places, errors } = readPlaces(bytes(toCsv(original)));
  assert.deepEqual(errors, []);
  const { line, ...back } = places[0];
  assert.deepEqual(back, original[0]);
});
