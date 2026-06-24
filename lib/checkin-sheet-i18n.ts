// 체크인 시트(인쇄 문서) 전용 다국어 라벨 — 5개 언어(ko/vi/en/zh/ru).
// 인쇄물은 선택한 게스트 언어로 "문서 전체"가 바뀐다(라벨·섹션·비품·동의서 모두).
// 주의: 비품 ko/vi 라벨은 messages/{ko,vi}.json amenities.items와 동일 내용을 미러한다
//       (편집기·체크아웃은 messages 사용, 인쇄 시트는 이 모듈 사용). 비품 추가 시 양쪽 갱신.
import type { AgreementLang } from "@/lib/agreement";

export type SheetLang = AgreementLang; // ko | vi | en | zh | ru

export interface SheetLabels {
  checkInDate: string;
  reservation: string;
  guest: string;
  guests: string;
  roster: string;
  phone: string;
  channel: string;
  stay: string;
  times: string;
  breakfast: string;
  yes: string;
  no: string;
  deposit: string;
  depositNone: string;
  depositHeld: string;
  depositRequired: string;
  wifi: string;
  wifiId: string;
  wifiPw: string;
  amenities: string;
  agreement: string;
  guestSign: string;
  staffConfirm: string;
  signDate: string;
  alreadySigned: string;
  nights: (n: number) => string;
  guestsValue: (n: number, max: number) => string;
  channels: { DIRECT: string; TRAVEL_AGENCY: string; LAND_AGENCY: string };
  amenityTable: { item: string; price: string; stocked: string; remaining: string; total: string };
}

export const SHEET_LABELS: Record<SheetLang, SheetLabels> = {
  ko: {
    checkInDate: "체크인", reservation: "예약 정보", guest: "게스트", guests: "인원",
    roster: "투숙객 명단",
    phone: "연락처", channel: "채널", stay: "숙박", times: "체크인 / 체크아웃 시각",
    breakfast: "조식", yes: "포함", no: "불포함",
    deposit: "보증금", depositNone: "보증금 없음", depositHeld: "보증금 수취 완료",
    depositRequired: "현장 수취 필요",
    wifi: "와이파이", wifiId: "네트워크", wifiPw: "비밀번호", amenities: "비품",
    agreement: "이용 동의서", guestSign: "게스트 서명", staffConfirm: "담당자 확인",
    signDate: "서명일", alreadySigned: "앱에서 서명 완료된 예약입니다.",
    nights: (n) => `${n}박`,
    guestsValue: (n, max) => `${n}명 (최대 ${max}명)`,
    channels: { DIRECT: "직접 예약", TRAVEL_AGENCY: "여행사", LAND_AGENCY: "랜드사" },
    amenityTable: { item: "항목", price: "가격", stocked: "수량", remaining: "남은수량", total: "합계" },
  },
  vi: {
    checkInDate: "Nhận phòng", reservation: "Thông tin đặt phòng", guest: "Khách", guests: "Số khách",
    roster: "Danh sách khách",
    phone: "Liên hệ", channel: "Kênh", stay: "Lưu trú", times: "Giờ nhận / trả phòng",
    breakfast: "Bữa sáng", yes: "Có", no: "Không",
    deposit: "Tiền đặt cọc", depositNone: "Không có tiền cọc", depositHeld: "Đã nhận tiền cọc",
    depositRequired: "Cần thu tại chỗ",
    wifi: "WiFi", wifiId: "Mạng", wifiPw: "Mật khẩu", amenities: "Tiện nghi",
    agreement: "Bản đồng ý sử dụng", guestSign: "Chữ ký khách", staffConfirm: "Xác nhận nhân viên",
    signDate: "Ngày ký", alreadySigned: "Đặt phòng đã được ký trên ứng dụng.",
    nights: (n) => `${n} đêm`,
    guestsValue: (n, max) => `${n} khách (tối đa ${max})`,
    channels: { DIRECT: "Đặt trực tiếp", TRAVEL_AGENCY: "Công ty du lịch", LAND_AGENCY: "Land tour" },
    amenityTable: { item: "Hạng mục", price: "Giá", stocked: "Số lượng", remaining: "Còn lại", total: "Tổng" },
  },
  en: {
    checkInDate: "Check-in", reservation: "Reservation", guest: "Guest", guests: "Guests",
    roster: "Guest list",
    phone: "Phone", channel: "Channel", stay: "Stay", times: "Check-in / Check-out time",
    breakfast: "Breakfast", yes: "Included", no: "Not included",
    deposit: "Deposit", depositNone: "No deposit", depositHeld: "Deposit received",
    depositRequired: "Collect on site",
    wifi: "WiFi", wifiId: "Network", wifiPw: "Password", amenities: "Amenities",
    agreement: "House Rules Agreement", guestSign: "Guest signature", staffConfirm: "Staff confirmation",
    signDate: "Date", alreadySigned: "This booking was already signed in the app.",
    nights: (n) => `${n} night(s)`,
    guestsValue: (n, max) => `${n} guest(s) (max ${max})`,
    channels: { DIRECT: "Direct", TRAVEL_AGENCY: "Travel agency", LAND_AGENCY: "Land operator" },
    amenityTable: { item: "Item", price: "Price", stocked: "Qty", remaining: "Remaining", total: "Total" },
  },
  zh: {
    checkInDate: "入住", reservation: "预订信息", guest: "客人", guests: "人数",
    roster: "入住客人名单",
    phone: "联系电话", channel: "渠道", stay: "住宿", times: "入住 / 退房时间",
    breakfast: "早餐", yes: "含", no: "不含",
    deposit: "押金", depositNone: "无押金", depositHeld: "已收押金",
    depositRequired: "现场收取",
    wifi: "无线网络", wifiId: "网络名称", wifiPw: "密码", amenities: "设施用品",
    agreement: "使用守则同意书", guestSign: "客人签名", staffConfirm: "工作人员确认",
    signDate: "签署日期", alreadySigned: "此预订已在应用中签署。",
    nights: (n) => `${n}晚`,
    guestsValue: (n, max) => `${n}人 (最多${max}人)`,
    channels: { DIRECT: "直接预订", TRAVEL_AGENCY: "旅行社", LAND_AGENCY: "地接社" },
    amenityTable: { item: "项目", price: "单价", stocked: "数量", remaining: "剩余", total: "合计" },
  },
  ru: {
    checkInDate: "Заезд", reservation: "Бронирование", guest: "Гость", guests: "Гостей",
    roster: "Список гостей",
    phone: "Телефон", channel: "Канал", stay: "Проживание", times: "Время заезда / выезда",
    breakfast: "Завтрак", yes: "Включён", no: "Не включён",
    deposit: "Депозит", depositNone: "Без депозита", depositHeld: "Депозит получен",
    depositRequired: "Взять на месте",
    wifi: "WiFi", wifiId: "Сеть", wifiPw: "Пароль", amenities: "Удобства",
    agreement: "Соглашение о правилах", guestSign: "Подпись гостя", staffConfirm: "Подпись сотрудника",
    signDate: "Дата", alreadySigned: "Это бронирование уже подписано в приложении.",
    nights: (n) => `${n} ноч.`,
    guestsValue: (n, max) => `${n} гост. (макс. ${max})`,
    channels: { DIRECT: "Прямое", TRAVEL_AGENCY: "Турагентство", LAND_AGENCY: "Местный оператор" },
    amenityTable: { item: "Позиция", price: "Цена", stocked: "Кол-во", remaining: "Остаток", total: "Итого" },
  },
};

export const AMENITY_CATEGORY_LABEL: Record<string, Record<SheetLang, string>> = {
  KITCHEN: { ko: "주방용품", vi: "Đồ bếp", en: "Kitchen", zh: "厨房用品", ru: "Кухня" },
  BATHROOM: { ko: "욕실용품", vi: "Đồ phòng tắm", en: "Bathroom", zh: "浴室用品", ru: "Ванная" },
  APPLIANCE: { ko: "가전류", vi: "Thiết bị điện", en: "Appliances", zh: "电器", ru: "Техника" },
  MINIBAR: { ko: "미니바", vi: "Minibar", en: "Minibar", zh: "迷你吧", ru: "Мини-бар" },
};

export const AMENITY_LABEL: Record<string, Record<SheetLang, string>> = {
  riceCooker: { ko: "전기밥솥", vi: "Nồi cơm điện", en: "Rice cooker", zh: "电饭煲", ru: "Рисоварка" },
  stove: { ko: "가스레인지/인덕션", vi: "Bếp ga/từ", en: "Stove/Induction", zh: "燃气灶/电磁炉", ru: "Плита/индукция" },
  pan: { ko: "프라이팬", vi: "Chảo", en: "Frying pan", zh: "平底锅", ru: "Сковорода" },
  pot: { ko: "냄비", vi: "Nồi", en: "Pot", zh: "锅", ru: "Кастрюля" },
  knifeBoard: { ko: "칼·도마", vi: "Dao & thớt", en: "Knife & board", zh: "刀·砧板", ru: "Нож и доска" },
  dishes: { ko: "그릇·접시", vi: "Bát đĩa", en: "Dishes & plates", zh: "碗·盘", ru: "Посуда" },
  cutlery: { ko: "수저·포크", vi: "Muỗng đũa nĩa", en: "Cutlery", zh: "餐具(勺叉)", ru: "Столовые приборы" },
  glasses: { ko: "컵", vi: "Ly cốc", en: "Glasses", zh: "杯子", ru: "Стаканы" },
  mug: { ko: "머그컵", vi: "Cốc/ly", en: "Mug", zh: "马克杯", ru: "Кружка" },
  kettle: { ko: "전기포트", vi: "Ấm đun nước", en: "Electric kettle", zh: "电热水壶", ru: "Чайник" },
  microwave: { ko: "전자레인지", vi: "Lò vi sóng", en: "Microwave", zh: "微波炉", ru: "Микроволновка" },
  toaster: { ko: "토스터", vi: "Máy nướng bánh mì", en: "Toaster", zh: "烤面包机", ru: "Тостер" },
  waterPurifier: { ko: "정수기", vi: "Máy lọc nước", en: "Water purifier", zh: "净水器", ru: "Фильтр для воды" },
  dishSoap: { ko: "주방세제·수세미", vi: "Nước rửa chén·miếng rửa", en: "Dish soap & sponge", zh: "洗洁精·百洁布", ru: "Средство для мытья посуды" },
  bottleOpener: { ko: "병따개", vi: "Đồ khui chai", en: "Bottle opener", zh: "开瓶器", ru: "Открывалка" },
  spices: { ko: "양념", vi: "Gia vị", en: "Seasonings", zh: "调味品", ru: "Приправы" },
  trashBin: { ko: "쓰레기통", vi: "Thùng rác", en: "Trash bin", zh: "垃圾桶", ru: "Мусорное ведро" },
  towelLarge: { ko: "큰 수건", vi: "Khăn lớn", en: "Large towel", zh: "大毛巾", ru: "Большое полотенце" },
  towelMedium: { ko: "중간 수건", vi: "Khăn vừa", en: "Medium towel", zh: "中毛巾", ru: "Среднее полотенце" },
  towelSmall: { ko: "작은 수건", vi: "Khăn nhỏ", en: "Small towel", zh: "小毛巾", ru: "Малое полотенце" },
  shampoo: { ko: "샴푸", vi: "Dầu gội", en: "Shampoo", zh: "洗发水", ru: "Шампунь" },
  conditioner: { ko: "린스(컨디셔너)", vi: "Dầu xả", en: "Conditioner", zh: "护发素", ru: "Кондиционер" },
  bodyWash: { ko: "바디워시", vi: "Sữa tắm", en: "Body wash", zh: "沐浴露", ru: "Гель для душа" },
  soap: { ko: "비누", vi: "Xà phòng", en: "Soap", zh: "香皂", ru: "Мыло" },
  handWash: { ko: "핸드워시", vi: "Nước rửa tay", en: "Hand wash", zh: "洗手液", ru: "Жидкое мыло для рук" },
  toothbrushKit: { ko: "칫솔·치약", vi: "Bàn chải & kem", en: "Toothbrush & paste", zh: "牙刷·牙膏", ru: "Зубная щётка и паста" },
  hairDryer: { ko: "헤어드라이어", vi: "Máy sấy tóc", en: "Hair dryer", zh: "吹风机", ru: "Фен" },
  bathMat: { ko: "발매트", vi: "Thảm chân", en: "Bath mat", zh: "浴室地垫", ru: "Коврик для ванной" },
  slippers: { ko: "실내 슬리퍼", vi: "Dép đi trong nhà", en: "Slippers", zh: "室内拖鞋", ru: "Тапочки" },
  toiletPaper: { ko: "화장지", vi: "Giấy vệ sinh", en: "Toilet paper", zh: "卫生纸", ru: "Туалетная бумага" },
  bathTrashBin: { ko: "욕실 쓰레기통", vi: "Thùng rác nhà tắm", en: "Bathroom bin", zh: "浴室垃圾桶", ru: "Корзина для ванной" },
  airConditioner: { ko: "에어컨", vi: "Máy lạnh", en: "Air conditioner", zh: "空调", ru: "Кондиционер" },
  tv: { ko: "TV", vi: "Tivi", en: "TV", zh: "电视", ru: "Телевизор" },
  fridge: { ko: "냉장고", vi: "Tủ lạnh", en: "Refrigerator", zh: "冰箱", ru: "Холодильник" },
  washingMachine: { ko: "세탁기", vi: "Máy giặt", en: "Washing machine", zh: "洗衣机", ru: "Стиральная машина" },
  dryingRack: { ko: "빨래건조대", vi: "Giá phơi đồ", en: "Drying rack", zh: "晾衣架", ru: "Сушилка" },
  iron: { ko: "다리미", vi: "Bàn ủi", en: "Iron", zh: "熨斗", ru: "Утюг" },
  vacuum: { ko: "청소기", vi: "Máy hút bụi", en: "Vacuum cleaner", zh: "吸尘器", ru: "Пылесос" },
  wifi: { ko: "와이파이", vi: "Wifi", en: "WiFi", zh: "无线网络", ru: "WiFi" },
  fan: { ko: "선풍기", vi: "Quạt", en: "Fan", zh: "风扇", ru: "Вентилятор" },
  waterHeater: { ko: "온수기", vi: "Bình nóng lạnh", en: "Water heater", zh: "热水器", ru: "Водонагреватель" },
  dehumidifier: { ko: "제습기", vi: "Máy hút ẩm", en: "Dehumidifier", zh: "除湿机", ru: "Осушитель" },
  speaker: { ko: "블루투스 스피커", vi: "Loa Bluetooth", en: "Bluetooth speaker", zh: "蓝牙音箱", ru: "Bluetooth-колонка" },
  safeBox: { ko: "금고", vi: "Két sắt", en: "Safe box", zh: "保险箱", ru: "Сейф" },
  water: { ko: "생수", vi: "Nước suối", en: "Bottled water", zh: "瓶装水", ru: "Бутилированная вода" },
  softDrink: { ko: "음료", vi: "Nước ngọt", en: "Soft drink", zh: "饮料", ru: "Напитки" },
  beer: { ko: "맥주", vi: "Bia", en: "Beer", zh: "啤酒", ru: "Пиво" },
  coffeeTea: { ko: "커피/티백", vi: "Cà phê/trà túi", en: "Coffee/Tea", zh: "咖啡/茶包", ru: "Кофе/чай" },
  snack: { ko: "과자", vi: "Bánh kẹo", en: "Snacks", zh: "零食", ru: "Закуски" },
};

/** 비품 itemKey의 표시 라벨 — 사전에 없으면(custom 등) customLabel 폴백 */
export function amenityLabel(itemKey: string, lang: SheetLang, customLabel?: string | null): string {
  return AMENITY_LABEL[itemKey]?.[lang] ?? customLabel ?? itemKey;
}
