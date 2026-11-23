# 바뀐 자리를 그림으로 보기

`render-diff`·`layout-anomaly`·SVG 텍스트는 rhwp 엔진으로 다시 배치한 결과라,
한글이 쓰는 줄 배치 캐시(`PARA_LINE_SEG`)를 보지 않는다. 수동 바이트 편집본이 이 셋에서
`edit set-cell` 산출과 똑같았는데, 수동 편집본만 SVG 에 빨강 `fill` 이 27개 있었고
한글에서 글자가 겹쳤다. 그래서 바뀐 쪽을 그림으로 떠서 차이 영역을 잘라 확대해 본다.

export-svg 의 -p 는 0 기준이고 파일 이름은 1 기준이다. `-p 1` 은 `<이름>_002.svg` 를
쓴다. 봉투에 `fontEnvironment` 와 `nativeFontSupply` 가 통째로 실리니 stdout 은 버리거나
`jq -c '{overflowCellLines, pages}'` 로 좁혀 받는다.

```bash
rhwp export-svg 원본.hwp -p 1 -o svg-a --json >/dev/null
rhwp export-svg 출력.hwp -p 1 -o svg-b --json >/dev/null
magick -density 110 svg-a/원본_002.svg a.png; magick -density 110 svg-b/출력_002.svg b.png
magick a.png b.png -compose difference -composite -colorspace Gray -threshold 10% -format "%@" info:
magick a.png -crop <위 bbox 둘레> +repage -resize 300% crop-a.png   # b.png 도 같은 자리
```
